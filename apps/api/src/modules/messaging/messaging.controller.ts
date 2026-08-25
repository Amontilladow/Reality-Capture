import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MessagingService } from './messaging.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { ReplyMessageDto } from './dto/reply-message.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('messages')
@ApiBearerAuth()
@Controller('messages')
export class MessagingController {
  constructor(private readonly svc: MessagingService) {}

  // Literal-path GET routes declared before the `:id`-shaped routes below
  // so NestJS's declaration-order route matching doesn't let a generic
  // param route shadow them.
  @Get('inbox')
  @ApiOperation({ summary: 'List threads where the current user is a recipient (one row per thread)' })
  async inbox(@CurrentUser() u: AuthenticatedUser, @Query() query: PaginationQuery) {
    const result = await this.svc.getInbox(u.companyId, u.id, query);
    return {
      data: result.data,
      meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages },
      error: null,
    };
  }

  @Get('sent')
  @ApiOperation({ summary: 'List threads the current user started (one row per thread)' })
  async sent(@CurrentUser() u: AuthenticatedUser, @Query() query: PaginationQuery) {
    const result = await this.svc.getSent(u.companyId, u.id, query);
    return {
      data: result.data,
      meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages },
      error: null,
    };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get the count of unread messages for the current user' })
  async unreadCount(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getUnreadCount(u.companyId, u.id), error: null };
  }

  @Get('thread/:threadId')
  @ApiOperation({ summary: 'Get every message in a thread, in order' })
  async thread(@CurrentUser() u: AuthenticatedUser, @Param('threadId') threadId: string) {
    return { data: await this.svc.getThread(u.companyId, u.id, threadId), error: null };
  }

  @Post()
  @ApiOperation({ summary: 'Compose a new message (starts a new thread)' })
  async create(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateMessageDto) {
    return { data: await this.svc.create(u.companyId, u.id, dto), error: null };
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Reply within an existing thread' })
  async reply(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReplyMessageDto) {
    return { data: await this.svc.reply(u.companyId, u.id, id, dto), error: null };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a message as read for the current user' })
  async markRead(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.markRead(u.companyId, u.id, id), error: null };
  }
}
