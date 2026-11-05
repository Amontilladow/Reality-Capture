import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('projects/:projectId/reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('kpis')
  @ApiOperation({ summary: 'Get combined Issues + Snagging + RFI KPI dashboard data for this project' })
  async getKpis(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getKpis(u.companyId, pid), error: null };
  }

  @Get('briefing')
  // Paid LLM call: own tighter bucket on top of the per-role AiUsageService
  // quota the service applies (same pattern as the assistant's ai.controller.ts).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'AI-generated cross-domain report briefing (Conclusion/Drivers/Impact/Action/Evidence), grounded in the same KPIs/risk summary this page already shows -- never a raw model call' })
  async getAiBriefing(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.generateAiBriefing(u.companyId, pid, u), error: null };
  }

  // Binary-response endpoint -- same StreamableFile + passthrough Response
  // pattern as rfis.controller.ts's :id/pdf route.
  @Get('pdf')
  @ApiOperation({ summary: 'Download this project\'s KPI report as a formatted PDF, with report attachments merged in' })
  async downloadPdf(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, filename } = await this.svc.generatePdf(u.companyId, pid);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
  }
}
