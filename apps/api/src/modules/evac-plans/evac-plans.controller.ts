import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@engineeringos/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCategoryAction } from '../../common/decorators/require-category-action.decorator';
import { EvacPlansService } from './evac-plans.service';
import { CreateEvacPlanJobDto, GetEvacPlanUploadUrlDto } from './dto/evac-plans.dto';

// 3D Evacuation Plans -- same permission convention as GIS Preparation:
// reads ungated, mutations gated by the existing 'drawings' category.
@ApiTags('evac-plans')
@ApiBearerAuth()
@Controller('projects/:projectId/evac-plans')
export class EvacPlansController {
  constructor(private readonly svc: EvacPlansService) {}

  @Post('upload-url')
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Get a presigned URL to upload an evacuation-plan PDF or the logo' })
  async getUploadUrl(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: GetEvacPlanUploadUrlDto) {
    return { data: await this.svc.getUploadUrl(u.companyId, pid, dto.filename, dto.kind), error: null };
  }

  @Post('jobs')
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Convert uploaded 2D evacuation plans to 3D evacuation-plan sheets' })
  async createJob(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateEvacPlanJobDto) {
    return { data: await this.svc.createJob(u.companyId, pid, u.id, dto), error: null };
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List recent evacuation-plan conversions for this project' })
  async listJobs(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.listJobs(u.companyId, pid), error: null };
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Get a conversion with its report and download links' })
  async getJob(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('jobId') jobId: string) {
    return { data: await this.svc.getJob(u.companyId, pid, jobId), error: null };
  }

  @Post('jobs/:jobId/rerun')
  @RequireCategoryAction('drawings', 'create', 'manage_project_records')
  @ApiOperation({ summary: 'Convert the same original PDFs again' })
  async rerunJob(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('jobId') jobId: string) {
    return { data: await this.svc.rerunJob(u.companyId, pid, u.id, jobId), error: null };
  }
}
