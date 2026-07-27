import { Controller, Get, Patch, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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
    @Query() query: PaginationQuery & { unreadOnly?: boolean },
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
}
