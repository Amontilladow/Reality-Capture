import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, HttpCode, HttpStatus, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { RfisService } from './rfis.service';
import { CreateRfiDto } from './dto/create-rfi.dto';
import { UpdateRfiDto } from './dto/update-rfi.dto';
import { RfiAttachmentUploadUrlDto } from './dto/rfi-attachment-upload-url.dto';
import { AddRfiAttachmentDto } from './dto/add-rfi-attachment.dto';
import { RequestClarificationDto } from './dto/request-clarification.dto';
import { RespondToRfiDto } from './dto/respond-to-rfi.dto';
import { AddRfiCommentDto } from './dto/add-rfi-comment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('rfis')
@ApiBearerAuth()
@Controller('projects/:projectId/rfis')
export class RfisController {
  constructor(private readonly svc: RfisService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new RFI' })
  async create(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateRfiDto) {
    return { data: await this.svc.create(u.companyId, pid, u.id, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List RFIs with filtering and pagination' })
  async findAll(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query() query: PaginationQuery & {
      status?: string; priority?: string; discipline?: string;
      costImpactLevel?: string; timeImpactLevel?: string; assignedTo?: string;
      dateFrom?: string; dateTo?: string;
    },
  ) {
    const result = await this.svc.findAll(u.companyId, pid, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get RFI count summary' })
  async getSummary(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getSummary(u.companyId, pid), error: null };
  }

  @Get(':id')
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.findOne(u.companyId, pid, id), error: null };
  }

  // The one binary-response endpoint in this API -- every other controller
  // returns the standard { data, error } JSON envelope. StreamableFile +
  // a passthrough Response (for the dynamic filename) is NestJS's standard
  // way to do this, not a workaround.
  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download this RFI as a formatted PDF' })
  async downloadPdf(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, filename } = await this.svc.generatePdf(u.companyId, pid, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
  }

  @Patch(':id')
  @RequireProjectPermission('manage_project_records')
  async update(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string, @Body() dto: UpdateRfiDto) {
    return { data: await this.svc.update(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Delete(':id')
  @RequireProjectPermission('manage_project_records')
  @HttpCode(HttpStatus.OK)
  async delete(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.delete(u.companyId, pid, id), error: null };
  }

  // ── Attachments ───────────────────────────────────────────────────────────
  @Post(':id/attachments/upload-url')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Get a presigned URL for uploading a supporting file (drawing, photo, calc sheet)' })
  async getAttachmentUploadUrl(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Body() dto: RfiAttachmentUploadUrlDto,
  ) {
    return { data: await this.svc.getAttachmentUploadUrl(u.companyId, pid, dto), error: null };
  }

  @Post(':id/attachments')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Register an uploaded file as an RFI attachment' })
  async addAttachment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddRfiAttachmentDto,
  ) {
    return { data: await this.svc.addAttachment(u.companyId, id, u.id, dto), error: null };
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'List this RFI\'s attachments' })
  async getAttachments(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.getAttachments(u.companyId, id), error: null };
  }

  @Delete(':id/attachments/:attachmentId')
  @RequireProjectPermission('manage_project_records')
  @HttpCode(HttpStatus.OK)
  async deleteAttachment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return { data: await this.svc.deleteAttachment(u.companyId, id, attachmentId), error: null };
  }

  // ── Workflow ─────────────────────────────────────────────────────────────
  // Deliberately NOT @RequireProjectPermission-gated -- the RFI's own
  // creator must be able to submit it even with no grant. Authorization
  // (creator OR manage_rfis OR project_lead OR super_admin) happens inside
  // RfisService.submit() itself, which the route-level guard can't express.
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a draft RFI (creator, manage_rfis grant, project lead, or super admin)' })
  async submit(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.submit(u.companyId, pid, id, u.id), error: null };
  }

  @Post(':id/request-clarification')
  @RequireProjectPermission('manage_rfis')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send an RFI back to its creator for clarification' })
  async requestClarification(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Body() dto: RequestClarificationDto,
  ) {
    return { data: await this.svc.requestClarification(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Post(':id/respond')
  @RequireProjectPermission('manage_rfis')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record the formal response to an RFI' })
  async respond(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Body() dto: RespondToRfiDto,
  ) {
    return { data: await this.svc.respond(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Post(':id/close')
  @RequireProjectPermission('manage_rfis')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close an RFI' })
  async close(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.close(u.companyId, pid, id, u.id), error: null };
  }

  @Post(':id/reopen')
  @RequireProjectPermission('manage_rfis')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen a closed RFI' })
  async reopen(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.reopen(u.companyId, pid, id, u.id), error: null };
  }

  // ── Comments ─────────────────────────────────────────────────────────────
  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a free-text clarification comment to an RFI' })
  async addComment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Body() dto: AddRfiCommentDto,
  ) {
    return { data: await this.svc.addComment(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Get(':id/comments')
  @ApiOperation({ summary: "List this RFI's clarification comments" })
  async getComments(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.getComments(u.companyId, id), error: null };
  }
}
