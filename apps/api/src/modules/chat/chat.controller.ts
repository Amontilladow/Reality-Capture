import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { MarkChatReadDto } from './dto/mark-chat-read.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

// ── Project channel history ────────────────────────────────────────────────
// Nested under projects/:projectId/chat, matching how other project-scoped
// resources (e.g. captures) are routed.
@ApiTags('chat')
@ApiBearerAuth()
@Controller('projects/:projectId/chat')
export class ProjectChatController {
  constructor(private readonly svc: ChatService) {}

  @Get('messages')
  @ApiOperation({ summary: 'Paginated project chat channel history, oldest to newest' })
  async messages(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query() query: PaginationQuery,
  ) {
    const result = await this.svc.getProjectChannelHistory(u.companyId, u.id, u.companyRole, projectId, query);
    return {
      data: result.data,
      meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages },
      error: null,
    };
  }
}

// ── DM channels / unread / read-tracking ───────────────────────────────────
// Top-level, matching messaging.controller.ts's own top-level style.
@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(private readonly svc: ChatService) {}

  @Get('dm/threads')
  @ApiOperation({ summary: "List the current user's DM conversations" })
  async dmThreads(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getDmThreads(u.companyId, u.id), error: null };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get the total unread chat count across every project + DM channel for the current user' })
  async unreadCount(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getUnreadCount(u.companyId, u.id), error: null };
  }

  @Get('dm/:otherUserId/messages')
  @ApiOperation({ summary: 'Paginated DM history with another user, oldest to newest (creates the channel on first contact)' })
  async dmMessages(
    @CurrentUser() u: AuthenticatedUser,
    @Param('otherUserId') otherUserId: string,
    @Query() query: PaginationQuery,
  ) {
    const result = await this.svc.getDmHistory(u.companyId, u.id, otherUserId, query);
    // channelId lives in `data` (alongside the messages it belongs to), not
    // `meta` -- `meta` is the fixed PaginationMeta shape (page/perPage/total/
    // totalPages) every paginated endpoint in this codebase returns, with no
    // room for extra business fields; the frontend chat.api.ts client was
    // already built against this exact { channelId, messages } data shape.
    return {
      data: { channelId: result.channelId, messages: result.data },
      meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages },
      error: null,
    };
  }

  @Patch('read')
  @ApiOperation({ summary: 'Mark a chat channel as read up to now for the current user' })
  async markRead(@CurrentUser() u: AuthenticatedUser, @Body() dto: MarkChatReadDto) {
    return { data: await this.svc.markRead(u.companyId, u.id, dto.channelType, dto.channelId), error: null };
  }
}
