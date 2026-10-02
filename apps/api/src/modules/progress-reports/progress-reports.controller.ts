import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedUser } from '@engineeringos/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ProgressReportsService } from './progress-reports.service';
import { GenerateProgressReportShareDto } from './dto/generate-progress-report-share.dto';

// ── Internal, authenticated side ────────────────────────────────────────────
@ApiTags('progress-reports')
@ApiBearerAuth()
@Controller('projects/:projectId/progress-reports')
export class ProgressReportsController {
  constructor(private readonly svc: ProgressReportsService) {}

  @Get()
  @ApiOperation({ summary: 'Automated Progress Report for this project, optionally scoped to a building/level and date range' })
  async get(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('buildingId') buildingId?: string,
    @Query('levelId') levelId?: string,
  ) {
    return { data: await this.svc.generate(u.companyId, pid, { dateFrom, dateTo, buildingId, levelId }), error: null };
  }

  @Get('pdf')
  @ApiOperation({ summary: 'Download the Automated Progress Report as a formatted PDF' })
  async getPdf(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('buildingId') buildingId: string | undefined,
    @Query('levelId') levelId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, filename } = await this.svc.generatePdf(u.companyId, pid, { dateFrom, dateTo, buildingId, levelId });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(buffer);
  }

  // Generating/revoking a public link is gated the same as managing any
  // other project record (manage_project_records) -- it hands out
  // unauthenticated view access to real project data, same sensitivity
  // class as the RFI external-access link it mirrors.
  @Post('shares')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Generate a public, expiring share link for an Automated Progress Report' })
  async createShare(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: GenerateProgressReportShareDto) {
    return { data: await this.svc.createShare(u.companyId, pid, u.id, dto), error: null };
  }

  @Get('shares')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'List share links generated for this project\'s progress reports' })
  async listShares(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.listShares(u.companyId, pid), error: null };
  }

  @Delete('shares/:shareId')
  @RequireProjectPermission('manage_project_records')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke a progress report share link immediately' })
  async revokeShare(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('shareId') shareId: string) {
    return { data: await this.svc.revokeShare(u.companyId, pid, shareId, u.id), error: null };
  }
}

// ── Public, unauthenticated side ────────────────────────────────────────────
// Prefixed distinctly (public/progress-reports/:token) from every
// @RequireProjectPermission-guarded route above, same separation as
// rfi-external-access.controller.ts's own public controller. The token
// itself is the only credential; there is no request.user on this route.
@ApiTags('progress-reports')
@Controller('public/progress-reports/:token')
export class ProgressReportsPublicController {
  constructor(private readonly svc: ProgressReportsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'View an Automated Progress Report via its public share link' })
  async getByToken(@Param('token') token: string) {
    return { data: await this.svc.generateByToken(token), error: null };
  }
}
