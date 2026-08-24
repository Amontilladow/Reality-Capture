import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Get combined Issues + Snagging KPI dashboard data for this project' })
  async getKpis(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getKpis(u.companyId, pid), error: null };
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
