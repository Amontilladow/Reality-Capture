import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BimService } from './bim.service';
import { GetModelUploadUrlDto } from './dto/get-model-upload-url.dto';
import { RegisterBimModelDto } from './dto/register-bim-model.dto';
import { UpdateElementStatusDto } from './dto/update-element-status.dto';
import { LinkCaptureToElementDto } from './dto/link-capture-to-element.dto';
import { CreatePinForElementDto } from './dto/create-pin-for-element.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('bim')
@ApiBearerAuth()
@RequireFeature('bim')
@Controller('projects/:projectId/bim')
export class BimController {
  constructor(private readonly svc: BimService) {}

  @Get('models')
  @ApiOperation({ summary: 'List BIM models for a project' })
  async getModels(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getModels(u.companyId, pid), error: null };
  }

  @Post('models/upload-url')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Get presigned URL for IFC model upload' })
  async getModelUploadUrl(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() body: GetModelUploadUrlDto) {
    return { data: await this.svc.getModelUploadUrl(u.companyId, pid, body.filename), error: null };
  }

  @Post('models')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Register a BIM model after upload and queue IFC parsing' })
  async registerModel(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: RegisterBimModelDto) {
    return { data: await this.svc.registerModel(u.companyId, pid, u.id, dto), error: null };
  }

  @Get('models/:modelId/status')
  @ApiOperation({ summary: 'Poll IFC processing status/progress for a model' })
  async getModelStatus(@CurrentUser() u: AuthenticatedUser, @Param('modelId') modelId: string) {
    return { data: await this.svc.getModelStatus(u.companyId, modelId), error: null };
  }

  @Post('models/:modelId/reprocess')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Re-queue IFC parsing for a failed or stuck model' })
  async reprocessModel(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('modelId') modelId: string) {
    return { data: await this.svc.reprocessModel(u.companyId, pid, modelId), error: null };
  }

  @Get('models/:modelId/viewer-data')
  @ApiOperation({ summary: 'Get a presigned Fragments URL + status for opening the model in the viewer' })
  async getModelViewerData(@CurrentUser() u: AuthenticatedUser, @Param('modelId') modelId: string) {
    return { data: await this.svc.getModelViewerData(u.companyId, modelId), error: null };
  }

  @Get('models/:modelId/provenance')
  @ApiOperation({ summary: 'Get provenance metadata (checksums, generation environment) for a model\'s artifacts -- diagnostic use, never returns file bytes or storage URLs' })
  async getModelProvenance(@CurrentUser() u: AuthenticatedUser, @Param('modelId') modelId: string) {
    return { data: await this.svc.getModelProvenance(u.companyId, modelId), error: null };
  }

  @Get('models/:modelId/hierarchy')
  @ApiOperation({ summary: 'Get the IFC-native spatial tree (Site/Building/Storey/Space) for a model' })
  async getHierarchy(@CurrentUser() u: AuthenticatedUser, @Param('modelId') modelId: string) {
    return { data: await this.svc.getHierarchy(u.companyId, modelId), error: null };
  }

  @Get('models/:modelId/elements/by-guid/:guid')
  @ApiOperation({ summary: 'Look up a BIM element by its IFC GUID (for viewer selection)' })
  async getElementByGuid(@CurrentUser() u: AuthenticatedUser, @Param('modelId') modelId: string, @Param('guid') guid: string) {
    return { data: await this.svc.getElementByGuid(u.companyId, modelId, guid), error: null };
  }

  @Get('elements')
  @ApiOperation({ summary: 'List BIM elements with construction status and issue counts' })
  async getElements(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query() query: PaginationQuery & { modelId?: string; ifcType?: string; levelId?: string },
  ) {
    const result = await this.svc.getElements(u.companyId, pid, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get('elements/:eid')
  async getElement(@CurrentUser() u: AuthenticatedUser, @Param('eid') eid: string) {
    return { data: await this.svc.getElement(u.companyId, eid), error: null };
  }

  @Patch('elements/:eid/status')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Update construction status for a BIM element' })
  async updateStatus(@CurrentUser() u: AuthenticatedUser, @Param('eid') eid: string, @Body() body: UpdateElementStatusDto) {
    return { data: await this.svc.updateElementStatus(u.companyId, eid, body.status), error: null };
  }

  @Post('elements/:eid/captures')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Link a capture to a BIM element' })
  async linkCapture(@CurrentUser() u: AuthenticatedUser, @Param('eid') eid: string, @Body() body: LinkCaptureToElementDto) {
    return { data: await this.svc.linkCaptureToElement(u.companyId, body.captureId, eid, u.id, body.linkType), error: null };
  }

  @Get('elements/:eid/captures')
  async getCapturesForElement(@CurrentUser() u: AuthenticatedUser, @Param('eid') eid: string) {
    return { data: await this.svc.getCapturesForElement(u.companyId, eid), error: null };
  }

  @Post('elements/:eid/pins')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Create a new pin attached to this element, with no floor-plan position yet' })
  async createPinForElement(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('eid') eid: string, @Body() body: CreatePinForElementDto) {
    return { data: await this.svc.createPinForElement(u.companyId, pid, eid, u.id, body.name || 'Untitled pin', body.assignedTo), error: null };
  }

  @Get('progress')
  @ApiOperation({ summary: 'Get construction progress summary by element type' })
  async getProgressSummary(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getProgressSummary(u.companyId, pid), error: null };
  }
}