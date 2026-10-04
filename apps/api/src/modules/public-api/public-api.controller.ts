import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiSecurity, ApiOperation } from '@nestjs/swagger';
import { PublicApiService } from './public-api.service';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentApiKey, type ApiKeyContext } from '../../common/decorators/current-api-key.decorator';
import type { PaginationQuery } from '@engineeringos/types';

// Read-only, API-key-authenticated surface for external integrations (F3).
// @Public() so the global JwtAuthGuard/TenancyGuard/RolesGuard/
// ProjectPermissionGuard chain (app.module.ts APP_GUARD) no-ops here, same
// as the progress-report public share controller; ApiKeyAuthGuard is the
// only auth this controller runs, applied explicitly since it's not in that
// global chain.
@ApiTags('public-api')
@ApiSecurity('api-key')
@Public()
@UseGuards(ApiKeyAuthGuard)
@Controller('public-api')
export class PublicApiController {
  constructor(private readonly svc: PublicApiService) {}

  @Get('projects')
  @ApiOperation({ summary: 'List projects in the authenticated tenant' })
  async listProjects(@CurrentApiKey() key: ApiKeyContext, @Query() query: PaginationQuery) {
    const result = await this.svc.listProjects(key.companyId, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get('projects/:projectId/captures')
  @ApiOperation({ summary: 'List captures for a project in the authenticated tenant' })
  async listCaptures(@CurrentApiKey() key: ApiKeyContext, @Param('projectId') projectId: string, @Query() query: PaginationQuery) {
    const result = await this.svc.listCaptures(key.companyId, projectId, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get('projects/:projectId/issues')
  @ApiOperation({ summary: 'List issues for a project in the authenticated tenant' })
  async listIssues(@CurrentApiKey() key: ApiKeyContext, @Param('projectId') projectId: string, @Query() query: PaginationQuery) {
    const result = await this.svc.listIssues(key.companyId, projectId, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get('projects/:projectId/progress')
  @ApiOperation({ summary: 'Get the live progress report for a project (defaults to the last 30 days)' })
  async getProgress(
    @CurrentApiKey() key: ApiKeyContext, @Param('projectId') projectId: string,
    @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string,
  ) {
    return { data: await this.svc.getProgress(key.companyId, projectId, dateFrom, dateTo), error: null };
  }
}
