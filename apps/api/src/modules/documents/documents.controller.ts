import { Controller, Get, Post, Delete, Body, Param, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { LinkDocumentDto } from './dto/link-document.dto';
import { GetDocumentUploadUrlDto } from './dto/get-upload-url.dto';
import { GenerateDocumentShareDto } from './dto/generate-document-share.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('projects/:projectId/documents')
export class DocumentsController {
  constructor(private readonly svc: DocumentsService) {}

  @Post('upload-url')
  @RequireProjectPermission('manage_project_records')
  async getUploadUrl(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() body: GetDocumentUploadUrlDto) {
    return { data: await this.svc.getUploadUrl(u.companyId, pid, body.filename, body.contentType), error: null };
  }

  @Post()
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Register a document (internal upload or external reference)' })
  async create(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateDocumentDto) {
    return { data: await this.svc.create(u.companyId, pid, u.id, dto), error: null };
  }

  @Get()
  async findAll(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Query() query: PaginationQuery & { docType?: string }) {
    const result = await this.svc.findAll(u.companyId, pid, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get(':id')
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.findOne(u.companyId, pid, id), error: null };
  }

  @Post(':id/link')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Link a document to a capture, element, location, or issue' })
  async link(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: LinkDocumentDto) {
    return { data: await this.svc.link(u.companyId, id, u.id, dto), error: null };
  }

  // Generating/revoking a public link is gated the same as every other
  // document mutation (manage_project_records) -- it hands out
  // unauthenticated download access to a real file, same sensitivity class
  // as the RFI/progress-report external links it mirrors.
  @Post(':id/shares')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Generate a public, expiring share link for a document -- for sending it outside the company without Dropbox/WeTransfer' })
  async createShare(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string, @Body() dto: GenerateDocumentShareDto) {
    return { data: await this.svc.createShare(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Get(':id/shares')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'List share links generated for this document' })
  async listShares(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.listShares(u.companyId, pid, id), error: null };
  }

  @Delete(':id/shares/:shareId')
  @RequireProjectPermission('manage_project_records')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke a document share link immediately' })
  async revokeShare(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string, @Param('shareId') shareId: string) {
    return { data: await this.svc.revokeShare(u.companyId, pid, id, shareId, u.id), error: null };
  }
}

// ── Public, unauthenticated side ────────────────────────────────────────────
// Prefixed distinctly (public/documents/:token) from every
// @RequireProjectPermission-guarded route above, same separation as
// rfi-external-access.controller.ts's and progress-reports.controller.ts's
// own public controllers. The token itself is the only credential; there is
// no request.user on this route.
@ApiTags('documents')
@Controller('public/documents/:token')
export class DocumentsPublicController {
  constructor(private readonly svc: DocumentsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'View/download a document via its public share link' })
  async getByToken(@Param('token') token: string) {
    return { data: await this.svc.getByToken(token), error: null };
  }
}