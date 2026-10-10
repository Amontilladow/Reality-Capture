import { Controller, Get, Post, Delete, Body, Param, Query, Res, HttpCode, HttpStatus, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { QaqcService, type QaqcRecordType } from './qaqc.service';
import { CreateQaqcRecordDto } from './dto/create-qaqc-record.dto';
import { CloseQaqcRecordDto } from './dto/close-qaqc-record.dto';
import { QaqcAttachmentUploadUrlDto } from './dto/qaqc-attachment-upload-url.dto';
import { AddQaqcAttachmentDto } from './dto/add-qaqc-attachment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireExactRoles } from '../../common/decorators/require-exact-roles.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

// Role lists per §2 of the brief -- membership checks (RequireExactRoles),
// never @Roles()'s weight threshold. See exact-roles.guard.ts's own
// comment for why: @Roles('qa_qc_manager') would also admit every
// higher-weight role (construction_manager, project_manager, bim_manager,
// engineering_manager, technical_director), which is the opposite of
// "only QAQC in charge can issue it."
const ISSUE_ROLES = ['qa_qc_manager', 'company_admin', 'super_admin'] as const;
const CLOSE_ROLES = ['construction_manager', 'technical_director', 'qa_qc_manager', 'company_admin', 'super_admin'] as const;
// Attachment management is shared by both sides of the workflow (the
// QAQC-in-charge attaching evidence when raising it, the closer attaching
// a closing document) -- the union of both role lists above.
const ATTACHMENT_ROLES = ['qa_qc_manager', 'construction_manager', 'technical_director', 'company_admin', 'super_admin'] as const;

@ApiTags('qaqc')
@ApiBearerAuth()
@Controller('projects/:projectId/qaqc')
export class QaqcController {
  constructor(private readonly svc: QaqcService) {}

  @Post()
  @RequireExactRoles(...ISSUE_ROLES)
  @ApiOperation({ summary: 'Create a new NCR or SOR (QAQC-in-charge or admin only)' })
  async create(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateQaqcRecordDto) {
    return { data: await this.svc.create(u.companyId, pid, u.id, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List NCR/SOR records with filtering and pagination' })
  async findAll(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query() query: PaginationQuery & { recordType?: QaqcRecordType; status?: string; priority?: string; discipline?: string; assignedTo?: string },
  ) {
    const result = await this.svc.findAll(u.companyId, pid, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get NCR/SOR count summary' })
  async getSummary(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getSummary(u.companyId, pid), error: null };
  }

  @Get(':id')
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.findOne(u.companyId, pid, id), error: null };
  }

  // Same binary-response StreamableFile + passthrough Response convention
  // as RfisController's own :id/pdf route.
  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download this NCR/SOR as a formatted PDF' })
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

  @Post(':id/close')
  @RequireExactRoles(...CLOSE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Respond to and close an NCR/SOR (construction/technical/QAQC-in-charge or admin)' })
  async close(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Body() dto: CloseQaqcRecordDto,
  ) {
    return { data: await this.svc.close(u.companyId, pid, id, u.id, dto), error: null };
  }

  // ── Attachments ───────────────────────────────────────────────────────────
  @Post(':id/attachments/upload-url')
  @RequireExactRoles(...ATTACHMENT_ROLES)
  @ApiOperation({ summary: 'Get a presigned URL for uploading a supporting file' })
  async getAttachmentUploadUrl(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Body() dto: QaqcAttachmentUploadUrlDto,
  ) {
    return { data: await this.svc.getAttachmentUploadUrl(u.companyId, pid, dto), error: null };
  }

  @Post(':id/attachments')
  @RequireExactRoles(...ATTACHMENT_ROLES)
  @ApiOperation({ summary: 'Register an uploaded file as an NCR/SOR attachment' })
  async addAttachment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddQaqcAttachmentDto,
  ) {
    return { data: await this.svc.addAttachment(u.companyId, id, u.id, dto), error: null };
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: "List this NCR/SOR's attachments" })
  async getAttachments(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.getAttachments(u.companyId, id), error: null };
  }

  @Delete(':id/attachments/:attachmentId')
  @RequireExactRoles(...ATTACHMENT_ROLES)
  @HttpCode(HttpStatus.OK)
  async deleteAttachment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return { data: await this.svc.deleteAttachment(u.companyId, id, attachmentId), error: null };
  }
}
