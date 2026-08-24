import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SnaggingService } from './snagging.service';
import { CreateSnagItemDto } from './dto/create-snag-item.dto';
import { UpdateSnagItemDto } from './dto/update-snag-item.dto';
import { AddSnagActivityDto } from './dto/add-snag-activity.dto';
import { ForwardSnagDto } from './dto/forward-snag.dto';
import { ForceSnagStatusDto } from './dto/force-snag-status.dto';
import { SnagAttachmentUploadUrlDto } from './dto/snag-attachment-upload-url.dto';
import { AddSnagAttachmentDto } from './dto/add-snag-attachment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('snagging')
@ApiBearerAuth()
@Controller('projects/:projectId/snag-items')
export class SnaggingController {
  constructor(private readonly svc: SnaggingService) {}

  @Post()
  async create(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateSnagItemDto) {
    return { data: await this.svc.create(u.companyId, pid, u.id, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List snag items with filtering and pagination' })
  async findAll(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query() query: PaginationQuery & { status?: string; priority?: string },
  ) {
    const result = await this.svc.findAll(u.companyId, pid, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get('summary')
  async getSummary(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getSummary(u.companyId, pid), error: null };
  }

  @Get(':id')
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.findOne(u.companyId, pid, id), error: null };
  }

  @Patch(':id')
  @RequireProjectPermission('manage_project_records')
  async update(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string, @Body() dto: UpdateSnagItemDto) {
    return { data: await this.svc.update(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Delete(':id')
  @RequireProjectPermission('manage_project_records')
  @HttpCode(HttpStatus.OK)
  async delete(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.delete(u.companyId, pid, id), error: null };
  }

  @Get(':id/activities')
  async getActivities(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.getActivities(u.companyId, id), error: null };
  }

  @Post(':id/activities')
  @ApiOperation({ summary: 'Add a comment or activity to a snag item' })
  async addActivity(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddSnagActivityDto) {
    return { data: await this.svc.addActivity(u.companyId, id, u.id, dto), error: null };
  }

  @Post(':id/forward')
  @ApiOperation({ summary: 'Forward (reassign) a snag item to another user' })
  async forward(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Body() dto: ForwardSnagDto,
  ) {
    return { data: await this.svc.forward(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Patch(':id/force-status')
  @Roles('company_admin', 'engineering_manager')
  @ApiOperation({ summary: 'Force a snag item to any status, bypassing normal transition rules' })
  async forceStatus(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Body() dto: ForceSnagStatusDto,
  ) {
    return { data: await this.svc.forceStatus(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Post(':id/attachments/upload-url')
  @ApiOperation({ summary: 'Get a presigned URL for uploading a file attachment to a snag item activity' })
  async getAttachmentUploadUrl(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Body() dto: SnagAttachmentUploadUrlDto,
  ) {
    return { data: await this.svc.getAttachmentUploadUrl(u.companyId, pid, dto), error: null };
  }

  @Post(':id/attachments')
  @ApiOperation({ summary: 'Register an uploaded file as a snag item activity attachment' })
  async addAttachment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddSnagAttachmentDto,
  ) {
    return { data: await this.svc.addAttachment(u.companyId, id, u.id, dto), error: null };
  }
}
