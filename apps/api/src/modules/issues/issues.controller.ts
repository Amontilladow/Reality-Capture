import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IssuesService } from './issues.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { AddActivityDto } from './dto/add-activity.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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

  @Get(':id')
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.findOne(u.companyId, pid, id), error: null };
  }

  @Patch(':id')
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