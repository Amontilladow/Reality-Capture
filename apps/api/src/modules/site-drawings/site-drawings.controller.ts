import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedUser, SiteDrawingWorkflowStatus } from '@engineeringos/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCategoryAction } from '../../common/decorators/require-category-action.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import { BulkDeleteDto } from '../../common/dto/bulk-delete.dto';
import { SiteDrawingsService } from './site-drawings.service';
import { SiteDrawingSyncService } from './site-drawing-sync.service';
import { GetSiteDrawingUploadUrlDto } from './dto/get-upload-url.dto';
import { ExtractSiteDrawingFieldsDto } from './dto/extract-fields.dto';
import { RegisterSiteDrawingDto } from './dto/register-drawing.dto';
import { CreateSiteDrawingOrgMappingDto } from './dto/org-mapping.dto';
import { RegisterSiteDrawingRevisionDto } from './dto/register-revision.dto';
import { SetSiteDrawingWorkflowStatusDto } from './dto/set-workflow-status.dto';
import { BulkSetSiteDrawingWorkflowStatusDto } from './dto/bulk-set-workflow-status.dto';
import { SetSiteDrawingNotifyMeDto } from './dto/set-notify-me.dto';
import { UpdateSiteDrawingDto } from './dto/update-site-drawing.dto';
import { StartOfflinePackageDto, CompleteOfflinePackageDto } from './dto/offline-package.dto';
import { TriggerSiteDrawingSyncDto } from './dto/trigger-sync.dto';

// Reads are ungated (company-wide read visibility), consistent with every
// other module in this app (risk, RFIs, issues, ...); see
// RiskController's own comment on this convention. Mutations go through
// RequireCategoryAction('drawings', ...), reusing the existing Drawings
// category rather than inventing a new permission module, per the brief's
// "do not create duplicate ... permission systems" instruction. 'drawings'
// already carries 'approve' as a distinct action from 'create'/'edit' in
// the owner's permission matrix (packages/types/org-permission.types.ts),
// which is exactly the create-vs-approve split section 5 needs.
@ApiTags('site-drawings')
@ApiBearerAuth()
@Controller('projects/:projectId/site-drawings')
export class SiteDrawingsController {
  constructor(
    private readonly svc: SiteDrawingsService,
    private readonly sync: SiteDrawingSyncService,
  ) {}

  @Post('sync')
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Trigger an immediate sync against an external source (otherwise runs on its own 15-minute schedule)' })
  async triggerSync(@Param('projectId') pid: string, @CurrentUser() u: AuthenticatedUser, @Body() dto: TriggerSiteDrawingSyncDto) {
    return { data: await this.sync.syncProject(u.companyId, pid, dto.provider ?? 'sharepoint'), error: null };
  }

  @Post('upload-url')
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Get a presigned URL for a drawing PDF upload (Local source only)' })
  async getUploadUrl(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() body: GetSiteDrawingUploadUrlDto) {
    return { data: await this.svc.getUploadUrl(u.companyId, pid, body.filename), error: null };
  }

  @Post()
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Register a new drawing with its first revision' })
  async register(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: RegisterSiteDrawingDto) {
    return { data: await this.svc.registerDrawing(u.companyId, pid, u.id, dto), error: null };
  }

  // Same embedded-text/OCR pipeline the bulk import path uses, run against
  // a single already-uploaded file -- lets "Register a drawing" pre-fill
  // its form instead of asking for everything typed by hand. Returns null
  // (not an error) when nothing could be confidently read; the caller
  // still submits through register() above, so nothing here writes
  // anything.
  @Post('extract-fields')
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Extract drawing number/title/revision/date/discipline from an already-uploaded PDF, to pre-fill the registration form' })
  async extractFields(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: ExtractSiteDrawingFieldsDto) {
    return { data: await this.svc.extractFields(u.companyId, pid, dto.storageKey), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'Search and filter the drawing register' })
  async list(
    @CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string,
    @Query('search') search?: string, @Query('discipline') discipline?: string,
    @Query('buildingOrZone') buildingOrZone?: string, @Query('floorOrLevel') floorOrLevel?: string,
    @Query('responsibleSubcontractor') responsibleSubcontractor?: string,
    @Query('workflowStatus') workflowStatus?: string, @Query('page') page?: string, @Query('perPage') perPage?: string,
  ) {
    const result = await this.svc.listDrawings(u.companyId, pid, {
      search, discipline, buildingOrZone, floorOrLevel, responsibleSubcontractor,
      workflowStatus: workflowStatus as SiteDrawingWorkflowStatus | undefined,
      page: page ? Number(page) : undefined, perPage: perPage ? Number(perPage) : undefined,
    });
    return { data: result.data, meta: { total: result.total }, error: null };
  }

  @Get('filter-options')
  @ApiOperation({ summary: 'Distinct discipline/building/floor/subcontractor values present in this project\'s register' })
  async getFilterOptions(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getFilterOptions(u.companyId, pid), error: null };
  }

  @Get('dashboard-stats')
  @ApiOperation({ summary: 'Register summary counts for the Hub landing dashboard' })
  async getDashboardStats(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getDashboardStats(u.companyId, pid), error: null };
  }

  @Get('org-mappings')
  @ApiOperation({ summary: 'Project-specific drawing-number-prefix -> organization mappings' })
  async listOrgMappings(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.listOrgMappings(u.companyId, pid), error: null };
  }

  @Post('org-mappings')
  @RequireCategoryAction('drawings', 'edit', 'manage_project_records')
  @ApiOperation({ summary: 'Create or update an organization mapping (same pattern + role replaces the existing one)' })
  async createOrgMapping(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateSiteDrawingOrgMappingDto) {
    return { data: await this.svc.createOrgMapping(u.companyId, pid, u.id, dto.pattern, dto.organizationName, dto.role), error: null };
  }

  @Delete('org-mappings/:mappingId')
  @RequireCategoryAction('drawings', 'edit', 'manage_project_records')
  @ApiOperation({ summary: 'Remove an organization mapping' })
  async deleteOrgMapping(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('mappingId') mappingId: string) {
    await this.svc.deleteOrgMapping(u.companyId, pid, mappingId);
    return { data: { removed: true }, error: null };
  }

  // Same filters as list() above, no pagination -- every matching drawing,
  // not just the current page (brief section 3: "Excel export").
  @Get('export')
  @ApiOperation({ summary: 'Download the filtered drawing register as an Excel workbook' })
  async exportRegister(
    @CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Res({ passthrough: true }) res: Response,
    @Query('search') search?: string, @Query('discipline') discipline?: string,
    @Query('buildingOrZone') buildingOrZone?: string, @Query('floorOrLevel') floorOrLevel?: string,
    @Query('responsibleSubcontractor') responsibleSubcontractor?: string,
    @Query('workflowStatus') workflowStatus?: string,
  ) {
    const { buffer, filename } = await this.svc.exportRegister(u.companyId, pid, {
      search, discipline, buildingOrZone, floorOrLevel, responsibleSubcontractor,
      workflowStatus: workflowStatus as SiteDrawingWorkflowStatus | undefined,
    });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
  }

  @Get('source-health')
  @ApiOperation({ summary: 'Reachability and last-sync facts for the Local source' })
  async getSourceHealth(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getSourceHealth(u.companyId, pid), error: null };
  }

  @Get('offline-packages')
  @ApiOperation({ summary: "The current user's offline drawing packages for this project" })
  async listOfflinePackages(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.listOfflinePackages(u.companyId, u.id, pid), error: null };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a drawing with its current revision' })
  async getDrawing(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.getDrawing(u.companyId, pid, id), error: null };
  }

  @Get(':id/revisions')
  @ApiOperation({ summary: 'Full revision history for a drawing, most recent first' })
  async listRevisions(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.listRevisions(u.companyId, pid, id), error: null };
  }

  // Correcting a mistake the extractor already made and nobody caught
  // before it left the Review Queue -- same capability resolveReview()
  // gives a reviewer, reachable here for a drawing already sitting
  // plainly in the register. Gated the same as createOrgMapping/
  // deleteOrgMapping above ('edit', not 'create': this isn't adding a new
  // record).
  @Patch(':id')
  @RequireCategoryAction('drawings', 'edit', 'manage_project_records')
  @ApiOperation({ summary: 'Correct a drawing\'s number, title, and/or current revision number' })
  async updateDrawing(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string, @Body() dto: UpdateSiteDrawingDto) {
    return { data: await this.svc.updateDrawing(u.companyId, pid, id, dto), error: null };
  }

  // Unlike addRevision()'s supersede-don't-delete model, this removes the
  // register entry and its entire revision history outright; gated on
  // manage_project_records directly (not RequireCategoryAction, whose
  // 'drawings' category has no 'delete' action) same as every other
  // module's record-delete route.
  @Delete(':id')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Delete a drawing and its entire revision history' })
  async deleteDrawing(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    await this.svc.delete(u.companyId, pid, id);
    return { data: { message: 'Drawing deleted.' }, error: null };
  }

  @Post('bulk-delete')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Delete multiple drawings (and their revision histories) at once' })
  async bulkDeleteDrawings(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: BulkDeleteDto) {
    return { data: await this.svc.bulkDelete(u.companyId, pid, dto.ids), error: null };
  }

  @Post(':id/revisions')
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Add a new revision to an existing drawing (supersedes the current one)' })
  async addRevision(
    @CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string,
    @Body() dto: RegisterSiteDrawingRevisionDto,
  ) {
    return { data: await this.svc.addRevision(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Patch(':id/revisions/:revisionId/workflow-status')
  @RequireCategoryAction('drawings', 'approve', 'manage_project_records')
  @ApiOperation({ summary: 'Set a revision\'s document-control status (e.g. Approved for Construction)' })
  async setWorkflowStatus(
    @CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string, @Param('revisionId') revisionId: string,
    @Body() dto: SetSiteDrawingWorkflowStatusDto,
  ) {
    return { data: await this.svc.setWorkflowStatus(u.companyId, pid, id, revisionId, dto.workflowStatus, u.id), error: null };
  }

  @Get(':id/notify-me')
  @ApiOperation({ summary: 'Whether the current user is watching this drawing (gets notified of its revisions/status changes)' })
  async getNotifyMe(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: { notifying: await this.svc.isWatchingDrawing(u.companyId, pid, id, u.id) }, error: null };
  }

  @Patch(':id/notify-me')
  @ApiOperation({ summary: 'Toggle whether the current user is watching this drawing -- a personal preference, not a document-control decision' })
  async setNotifyMe(
    @CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string, @Body() dto: SetSiteDrawingNotifyMeDto,
  ) {
    return { data: await this.svc.setWatchingDrawing(u.companyId, pid, id, u.id, dto.notify), error: null };
  }

  @Post('bulk-workflow-status')
  @RequireCategoryAction('drawings', 'approve', 'manage_project_records')
  @ApiOperation({ summary: 'Set the document-control status on every current revision of a batch of drawings at once' })
  async bulkSetWorkflowStatus(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: BulkSetSiteDrawingWorkflowStatusDto) {
    return { data: await this.svc.bulkSetWorkflowStatus(u.companyId, pid, dto.ids, dto.workflowStatus, u.id), error: null };
  }

  @Get('revisions/:revisionId/download')
  @ApiOperation({ summary: "A short-lived, authorized URL for a revision's stored file ('view' for the in-browser viewer, always allowed; 'download' for an explicit save, blocked once the revision is superseded)" })
  async getDownloadUrl(
    @CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('revisionId') revisionId: string,
    @Query('purpose') purpose?: 'view' | 'download',
  ) {
    return { data: await this.svc.getAuthorizedDownloadUrl(u.companyId, pid, u.id, revisionId, purpose === 'download' ? 'download' : 'view'), error: null };
  }

  @Post('offline-packages')
  @ApiOperation({ summary: 'Start tracking an explicit offline download — opt-in, per user' })
  async startOfflinePackage(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: StartOfflinePackageDto) {
    return { data: await this.svc.startOfflinePackage(u.companyId, u.id, pid, dto.revisionId), error: null };
  }

  @Patch('offline-packages/:packageId/complete')
  @ApiOperation({ summary: 'Report the outcome of a client-side download (never silently assumed complete)' })
  async completeOfflinePackage(
    @CurrentUser() u: AuthenticatedUser, @Param('packageId') packageId: string, @Body() dto: CompleteOfflinePackageDto,
  ) {
    return { data: await this.svc.completeOfflinePackage(u.companyId, u.id, packageId, dto), error: null };
  }

  @Post('offline-packages/:packageId/revalidate')
  @ApiOperation({ summary: 'Revalidate an offline package against the current register on reconnect' })
  async revalidateOfflinePackage(@CurrentUser() u: AuthenticatedUser, @Param('packageId') packageId: string) {
    return { data: await this.svc.revalidateOfflinePackage(u.companyId, u.id, packageId), error: null };
  }

  @Patch('offline-packages/:packageId/remove')
  @ApiOperation({ summary: 'Remove an offline package record (the client deletes the local IndexedDB bytes)' })
  async removeOfflinePackage(@CurrentUser() u: AuthenticatedUser, @Param('packageId') packageId: string) {
    await this.svc.removeOfflinePackage(u.companyId, u.id, packageId);
    return { data: { removed: true }, error: null };
  }
}
