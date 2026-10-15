import { Controller, Get, Post, Delete, Body, Param, Query, Res, HttpCode, HttpStatus, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { QaqcService, type QaqcRecordType } from './qaqc.service';
import { CreateQaqcRecordDto } from './dto/create-qaqc-record.dto';
import { RespondQaqcRecordDto } from './dto/respond-qaqc-record.dto';
import { ConfirmQaqcRecordDto } from './dto/confirm-qaqc-record.dto';
import { QaqcAttachmentUploadUrlDto } from './dto/qaqc-attachment-upload-url.dto';
import { AddQaqcAttachmentDto } from './dto/add-qaqc-attachment.dto';
import { AddQaqcCaptureDto } from './dto/add-qaqc-capture.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireExactRoles } from '../../common/decorators/require-exact-roles.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

// Role lists per §2 of the brief -- membership checks (RequireExactRoles),
// never @Roles()'s weight threshold. See exact-roles.guard.ts's own
// comment for why: @Roles('qa_qc_manager') would also admit every
// higher-weight role (construction_manager, project_manager, bim_manager,
// engineering_manager, technical_director), which is the opposite of
// "only QAQC in charge can issue it."
//
// NCR/SOR and WIR/MIR run issue/respond with the roles SWAPPED (NCR/SOR:
// QAQC issues, construction responds; WIR/MIR: construction issues, QAQC
// responds -- a WIR/MIR *is* the construction team's request for an
// inspection). That swap can't be expressed as a single static role list
// per route, since both routes serve all four record types -- so create()
// and respond() each get this broadened guard (the union of both groups,
// the same set ATTACHMENT_ROLES already was) as a coarse pre-filter, and
// QaqcService does the exact-for-this-type check once it knows the
// record's actual record_type (see ISSUE_ROLES_BY_TYPE/RESPOND_ROLES_BY_TYPE
// there). CONFIRM_ROLES is the one gate that never varies by type --
// QAQC-in-charge confirms every record type -- so it stays a precise,
// unbroadened guard with no service-level check needed.
const QAQC_OR_CONSTRUCTION_ROLES = ['qa_qc_manager', 'construction_manager', 'project_manager', 'technical_director', 'engineering_manager', 'company_admin', 'super_admin'] as const;
const CONFIRM_ROLES = ['qa_qc_manager', 'company_admin', 'super_admin'] as const;
// Attachment/photo management is shared by both sides of the workflow,
// for every record type -- same union as the broadened create/respond guard.
const ATTACHMENT_ROLES = QAQC_OR_CONSTRUCTION_ROLES;

@ApiTags('qaqc')
@ApiBearerAuth()
@Controller('projects/:projectId/qaqc')
export class QaqcController {
  constructor(private readonly svc: QaqcService) {}

  @Post()
  @RequireExactRoles(...QAQC_OR_CONSTRUCTION_ROLES)
  @ApiOperation({ summary: 'Create a new NCR/SOR (QAQC-in-charge) or WIR/MIR (construction team), or admin' })
  async create(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateQaqcRecordDto) {
    return { data: await this.svc.create(u.companyId, pid, u.id, u.companyRole, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List NCR/SOR/WIR/MIR records with filtering and pagination' })
  async findAll(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query() query: PaginationQuery & { recordType?: QaqcRecordType; status?: string; priority?: string; discipline?: string; assignedTo?: string },
  ) {
    const result = await this.svc.findAll(u.companyId, pid, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get NCR/SOR/WIR/MIR count summary' })
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
  @ApiOperation({ summary: 'Download this record as a formatted PDF' })
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

  // ── Two-step close ───────────────────────────────────────────────────────
  @Post(':id/respond')
  @RequireExactRoles(...QAQC_OR_CONSTRUCTION_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 1: respond to an open record -- construction team for NCR/SOR, QAQC-in-charge for WIR/MIR, or admin' })
  async respond(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Body() dto: RespondQaqcRecordDto,
  ) {
    return { data: await this.svc.respond(u.companyId, pid, id, u.id, u.companyRole, dto), error: null };
  }

  @Post(':id/confirm')
  @RequireExactRoles(...CONFIRM_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 2: confirm or reject a response (QAQC-in-charge or admin only)' })
  async confirm(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Body() dto: ConfirmQaqcRecordDto,
  ) {
    return { data: await this.svc.confirm(u.companyId, pid, id, u.id, dto), error: null };
  }

  // ── Generic document attachments ("+Add document") ─────────────────────
  @Post(':id/attachments/upload-url')
  @RequireExactRoles(...ATTACHMENT_ROLES)
  @ApiOperation({ summary: 'Get a presigned URL for uploading a supporting document' })
  async getAttachmentUploadUrl(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Body() dto: QaqcAttachmentUploadUrlDto,
  ) {
    return { data: await this.svc.getAttachmentUploadUrl(u.companyId, pid, dto), error: null };
  }

  @Post(':id/attachments')
  @RequireExactRoles(...ATTACHMENT_ROLES)
  @ApiOperation({ summary: 'Register an uploaded file as a document attachment' })
  async addAttachment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddQaqcAttachmentDto,
  ) {
    return { data: await this.svc.addAttachment(u.companyId, id, u.id, dto), error: null };
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: "List this record's document attachments" })
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

  // ── Quick photo picker ("+Add photo") -- links an already-uploaded
  // Capture, mirroring IssuesController's POST :id/captures. ─────────────
  @Post(':id/captures')
  @RequireExactRoles(...ATTACHMENT_ROLES)
  @ApiOperation({ summary: 'Link an already-uploaded Capture (a quick photo) to this record' })
  async addCapture(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddQaqcCaptureDto,
  ) {
    return { data: await this.svc.linkCapture(u.companyId, id, u.id, dto), error: null };
  }

  @Get(':id/captures')
  @ApiOperation({ summary: "List the Capture photos linked to this record" })
  async getCaptures(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.getLinkedCaptures(u.companyId, id), error: null };
  }
}
