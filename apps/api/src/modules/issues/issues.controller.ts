import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IssuesService } from './issues.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { AddActivityDto } from './dto/add-activity.dto';
import { ForwardIssueDto } from './dto/forward-issue.dto';
import { ForceStatusDto } from './dto/force-status.dto';
import { BulkCloseIssuesDto } from './dto/bulk-close-issues.dto';
import { BroadcastReminderDto } from './dto/broadcast-reminder.dto';
import { UserReminderDto } from './dto/user-reminder.dto';
import { WarnUserDto } from './dto/warn-user.dto';
import { IssueAttachmentUploadUrlDto } from './dto/issue-attachment-upload-url.dto';
import { AddIssueAttachmentDto } from './dto/add-issue-attachment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('issues')
@ApiBearerAuth()
@Controller('projects/:projectId/issues')
export class IssuesController {
  constructor(private readonly svc: IssuesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new issue' })
  async create(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateIssueDto) {
    return { data: await this.svc.create(u.companyId, pid, u.id, dto), error: null };
  }

  @Post('screenshot-upload-url')
  @ApiOperation({ summary: 'Get a presigned URL for uploading a BIM-viewer view-state screenshot, before creating an issue' })
  async getScreenshotUploadUrl(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getScreenshotUploadUrl(u.companyId, pid), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List issues with filtering, search, and pagination' })
  async findAll(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query() query: PaginationQuery & { status?: string; priority?: string; overdue?: boolean; myIssues?: boolean },
  ) {
    const result = await this.svc.findAll(u.companyId, pid, { ...query, userId: u.id });
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get issue count summary by status and priority' })
  async getSummary(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getSummary(u.companyId, pid), error: null };
  }

  // ── Bulk close (ticket 2b) ──────────────────────────────────────────────
  // Declared before ':id' below (like 'summary' above it) so it isn't
  // swallowed by the ':id' param route.
  @Post('bulk-close')
  @ApiOperation({ summary: 'Close multiple issues at once' })
  async bulkClose(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: BulkCloseIssuesDto) {
    return { data: await this.svc.bulkClose(u.companyId, pid, u.id, dto), error: null };
  }

  // ── Reminders (ticket 2b) ────────────────────────────────────────────────
  @Get('reminders')
  @ApiOperation({ summary: 'List sent reminders, most recent first' })
  async listReminders(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Query() query: PaginationQuery) {
    const result = await this.svc.listReminders(u.companyId, pid, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Post('reminders/broadcast')
  @Roles('company_admin', 'engineering_manager')
  @ApiOperation({ summary: 'Send a reminder to every open issue in the project' })
  async broadcastReminder(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: BroadcastReminderDto) {
    return { data: await this.svc.broadcastReminder(u.companyId, pid, u.id, dto), error: null };
  }

  @Post('reminders/user')
  @Roles('company_admin', 'engineering_manager')
  @ApiOperation({ summary: "Send a reminder for one user's open issues" })
  async userReminder(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: UserReminderDto) {
    return { data: await this.svc.userReminder(u.companyId, pid, u.id, dto), error: null };
  }

  @Post('warn-user')
  @Roles('company_admin', 'engineering_manager')
  @ApiOperation({ summary: "Log a manual warning against one user's overdue issues" })
  async warnUser(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: WarnUserDto) {
    return { data: await this.svc.warnUser(u.companyId, pid, u.id, dto), error: null };
  }

  @Get(':id')
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.findOne(u.companyId, pid, id), error: null };
  }

  @Patch(':id')
  @RequireProjectPermission('manage_issues')
  async update(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string, @Body() dto: UpdateIssueDto) {
    return { data: await this.svc.update(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.delete(u.companyId, pid, id, u.id, u.companyRole), error: null };
  }

  @Get(':id/activities')
  async getActivities(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.getActivities(u.companyId, id), error: null };
  }

  @Post(':id/activities')
  @ApiOperation({ summary: 'Add a comment or activity to an issue' })
  async addActivity(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddActivityDto) {
    return { data: await this.svc.addActivity(u.companyId, id, u.id, dto), error: null };
  }

  @Post(':id/captures')
  @ApiOperation({ summary: 'Link an existing capture as evidence for this issue' })
  async addCapture(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { captureId: string; isPrimary?: boolean; caption?: string },
  ) {
    return { data: await this.svc.addCapture(u.companyId, id, u.id, body.captureId, body.isPrimary, body.caption), error: null };
  }

  // ── Forward (ticket 2b) ──────────────────────────────────────────────────
  @Post(':id/forward')
  @ApiOperation({ summary: 'Forward (reassign) an issue to another user' })
  async forward(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Body() dto: ForwardIssueDto,
  ) {
    return { data: await this.svc.forward(u.companyId, pid, id, u.id, dto), error: null };
  }

  // ── Admin force-status (ticket 2b) ───────────────────────────────────────
  @Patch(':id/force-status')
  @Roles('company_admin', 'engineering_manager')
  @ApiOperation({ summary: 'Force an issue to any status, bypassing normal transition rules' })
  async forceStatus(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Body() dto: ForceStatusDto,
  ) {
    return { data: await this.svc.forceStatus(u.companyId, pid, id, u.id, dto), error: null };
  }

  // ── Attachments (ticket 2b) ───────────────────────────────────────────────
  // Presigned-PUT pattern, same shape as documents.controller.ts's
  // upload-url + register endpoints.
  @Post(':id/attachments/upload-url')
  @ApiOperation({ summary: 'Get a presigned URL for uploading a file attachment to an issue activity' })
  async getAttachmentUploadUrl(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Body() dto: IssueAttachmentUploadUrlDto,
  ) {
    return { data: await this.svc.getAttachmentUploadUrl(u.companyId, pid, dto), error: null };
  }

  @Post(':id/attachments')
  @ApiOperation({ summary: 'Register an uploaded file as an issue activity attachment' })
  async addAttachment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddIssueAttachmentDto,
  ) {
    return { data: await this.svc.addAttachment(u.companyId, id, u.id, dto), error: null };
  }
}

// Element-scoped endpoint — GET /elements/:id/issues
import { Controller as Ctrl2 } from '@nestjs/common';
@ApiTags('issues')
@ApiBearerAuth()
@Ctrl2('elements')
export class ElementIssuesController {
  constructor(private readonly svc: IssuesService) {}

  @Get(':elementId/issues')
  @ApiOperation({ summary: 'Get all open issues for a BIM element' })
  async getByElement(@CurrentUser() u: AuthenticatedUser, @Param('elementId') eid: string) {
    return { data: await this.svc.getByElement(u.companyId, eid), error: null };
  }
}

// Flat, project-agnostic lookup — GET /issues/:id. Notifications only carry
// resourceType/resourceId (no projectId), so this is what resolves a
// notification into a real "/projects/:projectId/issues" link.
import { Controller as Ctrl3 } from '@nestjs/common';
@ApiTags('issues')
@ApiBearerAuth()
@Ctrl3('issues')
export class IssueLookupController {
  constructor(private readonly svc: IssuesService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Look up which project an issue belongs to, by id alone' })
  async lookup(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.lookupProjectForIssue(u.companyId, id), error: null };
  }
}