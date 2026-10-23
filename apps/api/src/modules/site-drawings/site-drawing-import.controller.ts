import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@engineeringos/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCategoryAction } from '../../common/decorators/require-category-action.decorator';
import { SiteDrawingImportService } from './site-drawing-import.service';
import { GetImportBatchUploadUrlDto, CreateImportBatchDto } from './dto/create-import-batch.dto';
import { ResolveReviewDto } from './dto/resolve-review.dto';

// Bulk ZIP/PDF ingestion (brief Phase 2) -- same permission convention as
// SiteDrawingsController: reads ungated, mutations gated by the existing
// 'drawings' category. A bulk import is, in effect, the same action as
// registering a drawing one at a time, just batched -- 'create' is the
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

  @Get(':batchId')
  @ApiOperation({ summary: 'Get an import batch\'s current status and counts' })
  async getBatch(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('batchId') batchId: string) {
    return { data: await this.svc.getBatch(u.companyId, pid, batchId), error: null };
  }
}
