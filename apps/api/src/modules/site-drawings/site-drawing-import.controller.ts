import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@engineeringos/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCategoryAction } from '../../common/decorators/require-category-action.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import { SiteDrawingImportService } from './site-drawing-import.service';
import { GetImportBatchUploadUrlDto, CreateImportBatchDto } from './dto/create-import-batch.dto';
import { ResolveReviewDto } from './dto/resolve-review.dto';
import { ConfirmAsRevisionDto } from './dto/confirm-as-revision.dto';
import { SplitAsNewDrawingDto } from './dto/split-as-new-drawing.dto';

// Bulk ZIP/PDF ingestion (brief Phase 2): same permission convention as
// SiteDrawingsController: reads ungated, mutations gated by the existing
// 'drawings' category. A bulk import is, in effect, the same action as
// registering a drawing one at a time, just batched; 'create' is the
// right action for both.
@ApiTags('site-drawings')
@ApiBearerAuth()
@Controller('projects/:projectId/site-drawings/import-batches')
export class SiteDrawingImportController {
  constructor(private readonly svc: SiteDrawingImportService) {}

  @Post('upload-url')
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Get a presigned URL to upload a ZIP (bulk) or single PDF drawing package' })
  async getUploadUrl(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: GetImportBatchUploadUrlDto) {
    return { data: await this.svc.getUploadUrl(u.companyId, pid, dto.filename), error: null };
  }

  @Post()
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Create an import batch and queue it for background processing' })
  async createBatch(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateImportBatchDto) {
    return { data: await this.svc.createBatch(u.companyId, pid, u.id, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List recent import batches for this project' })
  async listBatches(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.listBatches(u.companyId, pid), error: null };
  }

  @Get('review-queue')
  @ApiOperation({ summary: 'Revisions flagged NEEDS_REVIEW or CONFLICT by the extraction pipeline' })
  async listReviewQueue(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.listReviewQueue(u.companyId, pid), error: null };
  }

  @Patch('review-queue/:revisionId')
  @RequireCategoryAction('drawings', 'edit', 'manage_project_records')
  @ApiOperation({ summary: 'Correct or confirm a flagged extraction' })
  async resolveReview(
    @CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('revisionId') revisionId: string, @Body() dto: ResolveReviewDto,
  ) {
    return { data: await this.svc.resolveReview(u.companyId, pid, revisionId, dto), error: null };
  }

  // Site Drawing Hub integrity hardening (Phase 1/2): the Review Queue's
  // two decisions on a revision reconcile() left un-promoted -- "yes,
  // genuinely a new revision of this drawing" (this route) or "no,
  // actually a different drawing" (split-as-new-drawing, below). Gated
  // the same as resolveReview() just above: correcting/confirming an
  // extraction is the 'edit' action on the 'drawings' category regardless
  // of which of the three resolution routes does it.
  @Patch('review-queue/:revisionId/confirm-as-revision')
  @RequireCategoryAction('drawings', 'edit', 'manage_project_records')
  @ApiOperation({ summary: 'Confirm a pending revision as a genuine new revision of its matched drawing, promoting it to current' })
  async confirmAsRevision(
    @CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('revisionId') revisionId: string, @Body() dto: ConfirmAsRevisionDto,
  ) {
    return { data: await this.svc.confirmRevisionAsNew(u.companyId, pid, revisionId, dto.reviewNotes), error: null };
  }

  @Patch('review-queue/:revisionId/split-as-new-drawing')
  @RequireCategoryAction('drawings', 'edit', 'manage_project_records')
  @ApiOperation({ summary: 'Detach a pending revision into its own new drawing, leaving the originally-matched drawing untouched' })
  async splitAsNewDrawing(
    @CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('revisionId') revisionId: string, @Body() dto: SplitAsNewDrawingDto,
  ) {
    return { data: await this.svc.splitRevisionAsNewDrawing(u.companyId, pid, revisionId, dto), error: null };
  }

  @Get(':batchId')
  @ApiOperation({ summary: 'Get an import batch\'s current status and counts' })
  async getBatch(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('batchId') batchId: string) {
    return { data: await this.svc.getBatch(u.companyId, pid, batchId), error: null };
  }

  // Gated on manage_project_records directly (not RequireCategoryAction,
  // whose 'drawings' category has no 'delete' action), same as every
  // other module's record-delete route.
  @Delete(':batchId')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Delete an import batch\'s log entry (never the drawings/revisions it created)' })
  async deleteBatch(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('batchId') batchId: string) {
    await this.svc.deleteBatch(u.companyId, pid, batchId);
    return { data: { message: 'Import batch deleted.' }, error: null };
  }
}
