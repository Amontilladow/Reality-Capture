import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@engineeringos/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCategoryAction } from '../../common/decorators/require-category-action.decorator';
import { GisPrepService } from './gis-prep.service';
import { CreateGisPrepJobDto, GetGisPrepUploadUrlDto, RerunGisPrepJobDto } from './dto/gis-prep.dto';

// GIS Preparation -- same permission convention as the Drawings modules:
// reads ungated, mutations gated by the existing 'drawings' category.
@ApiTags('gis-prep')
@ApiBearerAuth()
@Controller('projects/:projectId/gis-prep')
export class GisPrepController {
  constructor(private readonly svc: GisPrepService) {}

  @Post('upload-url')
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Get a presigned URL to upload a DXF/DWG drawing for GIS preparation' })
  async getUploadUrl(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: GetGisPrepUploadUrlDto) {
    return { data: await this.svc.getUploadUrl(u.companyId, pid, dto.filename), error: null };
  }

  @Post('jobs')
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Create a GIS preparation job and queue it' })
  async createJob(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateGisPrepJobDto) {
    return { data: await this.svc.createJob(u.companyId, pid, u.id, dto), error: null };
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List recent GIS preparation jobs for this project' })
  async listJobs(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.listJobs(u.companyId, pid), error: null };
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Get a GIS preparation job with its QC report and download links' })
  async getJob(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('jobId') jobId: string) {
    return { data: await this.svc.getJob(u.companyId, pid, jobId), error: null };
  }

  @Post('jobs/:jobId/rerun')
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Re-run a job on the same original drawing with new decisions' })
  async rerunJob(
    @CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('jobId') jobId: string, @Body() dto: RerunGisPrepJobDto,
  ) {
    return { data: await this.svc.rerunJob(u.companyId, pid, u.id, jobId, dto.settings), error: null };
  }
}
