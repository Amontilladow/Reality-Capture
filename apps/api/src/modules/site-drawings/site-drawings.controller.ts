import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { AuthenticatedUser, SiteDrawingWorkflowStatus } from '@engineeringos/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCategoryAction } from '../../common/decorators/require-category-action.decorator';
import { SiteDrawingsService } from './site-drawings.service';
import { GetSiteDrawingUploadUrlDto } from './dto/get-upload-url.dto';
import { RegisterSiteDrawingDto } from './dto/register-drawing.dto';
import { RegisterSiteDrawingRevisionDto } from './dto/register-revision.dto';
import { SetSiteDrawingWorkflowStatusDto } from './dto/set-workflow-status.dto';
import { StartOfflinePackageDto, CompleteOfflinePackageDto } from './dto/offline-package.dto';

// Reads are ungated (company-wide read visibility), consistent with every
// other module in this app (risk, RFIs, issues, ...) -- see
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
  constructor(private readonly svc: SiteDrawingsService) {}

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

  @Get()
  @ApiOperation({ summary: 'Search and filter the drawing register' })
  async list(
    @CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string,
    @Query('search') search?: string, @Query('discipline') discipline?: string,
    @Query('buildingOrZone') buildingOrZone?: string, @Query('floorOrLevel') floorOrLevel?: string,
    @Query('workflowStatus') workflowStatus?: string, @Query('page') page?: string, @Query('perPage') perPage?: string,
  ) {
    const result = await this.svc.listDrawings(u.companyId, pid, {
      search, discipline, buildingOrZone, floorOrLevel,
      workflowStatus: workflowStatus as SiteDrawingWorkflowStatus | undefined,
      page: page ? Number(page) : undefined, perPage: perPage ? Number(perPage) : undefined,
    });
    return { data: result.data, meta: { total: result.total }, error: null };
  }

  @Get('filter-options')
  @ApiOperation({ summary: 'Distinct discipline/building/floor values present in this project\'s register' })
  async getFilterOptions(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getFilterOptions(u.companyId, pid), error: null };
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
    return { data: await this.svc.setWorkflowStatus(u.companyId, pid, id, revisionId, dto.workflowStatus), error: null };
  }

  @Get('revisions/:revisionId/download')
  @ApiOperation({ summary: "A short-lived, authorized download URL for a revision's stored file" })
  async getDownloadUrl(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('revisionId') revisionId: string) {
    return { data: await this.svc.getAuthorizedDownloadUrl(u.companyId, pid, u.id, revisionId), error: null };
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
