import { Controller, Get, Patch, Param, Query, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService, type NotificationCategory } from './notifications.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List the current user\u2019s notifications (poll this endpoint)' })
  async findAll(
    @CurrentUser() u: AuthenticatedUser,
    @Query() query: PaginationQuery & { unreadOnly?: boolean; category?: string; search?: string },
  ) {
    const result = await this.svc.findAll(u.companyId, u.id, query);
    return {
      data: result.data,
      meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages },
      error: null,
    };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get the count of unread notifications for the current user' })
  async unreadCount(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getUnreadCount(u.companyId, u.id), error: null };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a single notification as read' })
  async markRead(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.markRead(u.companyId, u.id, id), error: null };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all of the current user\u2019s notifications as read' })
  async markAllRead(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.markAllRead(u.companyId, u.id), error: null };
  }

  @Patch(':id/acknowledge')
  @ApiOperation({ summary: 'Acknowledge a notification -- distinct from read: a human confirming they will act on it' })
  async acknowledge(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.acknowledge(u.companyId, u.id, id), error: null };
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get the current user’s own email/WhatsApp notification preferences' })
  async getPreferences(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getPreferences(u.companyId, u.id), error: null };
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update the current user’s own email/WhatsApp notification preferences' })
  async updatePreferences(@CurrentUser() u: AuthenticatedUser, @Body() dto: UpdateNotificationPreferencesDto) {
    return {
      data: await this.svc.updatePreferences(u.companyId, u.id, { ...dto, mutedCategories: dto.mutedCategories as NotificationCategory[] | undefined }),
      error: null,
    };
  }

  // Admin console (master spec section 8): company_admin-gated, same
  // pattern as ReportingLinesController's own method-level @Roles().
  @Get('admin/email-deliveries')
  @Roles('company_admin')
  @ApiOperation({ summary: 'Admin: list this company’s email notification delivery log' })
  async listEmailDeliveries(@CurrentUser() u: AuthenticatedUser, @Query() query: PaginationQuery) {
    const result = await this.svc.listEmailDeliveries(u.companyId, query);
    return {
      data: result.data,
      meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages },
      error: null,
    };
  }

  @Get('admin/whatsapp-deliveries')
  @Roles('company_admin')
  @ApiOperation({ summary: 'Admin: list this company’s WhatsApp notification delivery log' })
  async listWhatsAppDeliveries(@CurrentUser() u: AuthenticatedUser, @Query() query: PaginationQuery) {
    const result = await this.svc.listWhatsAppDeliveries(u.companyId, query);
    return {
      data: result.data,
      meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages },
      error: null,
    };
  }
}
