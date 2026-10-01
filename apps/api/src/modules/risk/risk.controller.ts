import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Delete, Res, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedUser, RiskNodeType } from '@engineeringos/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RiskService } from './risk.service';
import { OverrideRiskDto } from './dto/override-risk.dto';
import { SetRiskStatusDto } from './dto/set-risk-status.dto';
import { AssignRiskOwnerDto } from './dto/assign-risk-owner.dto';
import { GenerateRiskPdfDto } from './dto/generate-risk-pdf.dto';
import { SetHumanAssessmentDto } from './dto/set-human-assessment.dto';

@ApiTags('risk')
@ApiBearerAuth()
@Controller('projects/:projectId/risk')
export class RiskController {
  constructor(
    private readonly risk: RiskService,
  ) {}

  @Post('recalculate')
  @ApiOperation({ summary: 'Rebuild the Project Risk Graph and recalculate every risk for this project ("Refresh analysis")' })
  async recalculate(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    await this.risk.recalculateProject(u.companyId, pid);
    return { data: { recalculated: true }, error: null };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Executive Risk Summary — overall score/level/trend and headline counts' })
  async getSummary(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.risk.getExecutiveSummary(u.companyId, pid), error: null };
  }

  @Get('top')
  @ApiOperation({ summary: 'Top management risks, ranked by current score' })
  async getTop(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Query('limit') limit?: string) {
    return { data: await this.risk.getTopRisks(u.companyId, pid, limit ? Number(limit) : undefined), error: null };
  }

  @Get('emerging')
  @ApiOperation({ summary: 'Emerging risks — not yet critical, but trending up' })
  async getEmerging(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Query('limit') limit?: string) {
    return { data: await this.risk.getEmergingRisks(u.companyId, pid, limit ? Number(limit) : undefined), error: null };
  }

  @Get('by-discipline')
  async getByDiscipline(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.risk.getRiskByDiscipline(u.companyId, pid), error: null };
  }

  @Get('by-location')
  async getByLocation(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.risk.getRiskByLocation(u.companyId, pid), error: null };
  }

  @Get('clusters')
  @ApiOperation({ summary: 'Locations with a concentration of connected open risk' })
  async getClusters(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.risk.getRiskClusters(u.companyId, pid), error: null };
  }

  @Get('trend')
  @ApiOperation({ summary: 'Real historical risk trend from stored snapshots — 7/14/30/90 days' })
  async getTrend(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Query('days') days?: string) {
    const parsed = Number(days) as 7 | 14 | 30 | 90;
    const validDays: (7 | 14 | 30 | 90)[] = [7, 14, 30, 90];
    return { data: await this.risk.getProjectRiskTrend(u.companyId, pid, validDays.includes(parsed) ? parsed : 30), error: null };
  }

  @Get('data-availability')
  @ApiOperation({ summary: 'Honest data-availability breakdown for empty/partial states' })
  async getDataAvailability(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.risk.getDataAvailability(u.companyId, pid), error: null };
  }

  @Get('briefing')
  @ApiOperation({ summary: 'AI-generated project risk briefing, grounded in the executive summary/top risks/clusters -- never a raw model call' })
  async getAiBriefing(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.risk.generateAiBriefing(u.companyId, pid), error: null };
  }

  // Binary-response endpoint -- same StreamableFile + passthrough Response
  // pattern as reports.controller.ts's own :projectId/reports/pdf route.
  // POST (not GET) because aiBriefing can run to a few paragraphs -- too
  // long to carry safely in a query string, same reasoning apiDownloadPost()
  // documents on the frontend.
  @Post('pdf')
  @HttpCode(200)
  @ApiOperation({ summary: 'Download this project\'s Risk Intelligence Report as a formatted PDF' })
  async downloadPdf(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Body() dto: GenerateRiskPdfDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, filename } = await this.risk.generatePdf(u.companyId, pid, dto.aiBriefing);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
  }

  @Get('graph')
  @ApiOperation({ summary: 'Project Risk Graph for visualization -- the whole project graph (optionally filtered), or one risk\'s bounded neighborhood' })
  async getGraph(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query('rootNodeId') rootNodeId?: string,
    @Query('maxDepth') maxDepth?: string,
    @Query('nodeTypes') nodeTypes?: string,
    @Query('discipline') discipline?: string,
  ) {
    if (rootNodeId) {
      const result = await this.risk.getGraphNeighborhood(u.companyId, pid, rootNodeId, maxDepth ? Number(maxDepth) : undefined);
      return { data: result, error: null };
    }
    const result = await this.risk.getProjectGraph(u.companyId, pid, {
      nodeTypes: nodeTypes ? (nodeTypes.split(',') as RiskNodeType[]) : undefined,
      discipline,
    });
    return { data: result, error: null };
  }

  @Get('graph/nodes/:nodeId')
  @ApiOperation({ summary: 'Node detail for the graph visualization: the node, its associated risk if any, and its direct neighbors' })
  async getGraphNodeDetail(@CurrentUser() u: AuthenticatedUser, @Param('nodeId') nodeId: string) {
    return { data: await this.risk.getNodeDetail(u.companyId, nodeId), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'Full filterable Risk Register' })
  async list(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.risk.listRisks(u.companyId, pid), error: null };
  }

  @Get(':riskId')
  async getOne(@CurrentUser() u: AuthenticatedUser, @Param('riskId') riskId: string) {
    return { data: await this.risk.getRisk(u.companyId, riskId), error: null };
  }

  @Get(':riskId/chain')
  @ApiOperation({ summary: 'Linear, explainable Risk Chain for this risk' })
  async getChain(@CurrentUser() u: AuthenticatedUser, @Param('riskId') riskId: string) {
    return { data: await this.risk.getRiskChain(u.companyId, riskId), error: null };
  }

  @Get(':riskId/evidence')
  @ApiOperation({ summary: 'Clickable evidence — every graph node backing this risk, resolved to display data' })
  async getEvidence(@CurrentUser() u: AuthenticatedUser, @Param('riskId') riskId: string) {
    return { data: await this.risk.getEvidenceWithNodes(u.companyId, riskId), error: null };
  }

  @Get(':riskId/history')
  @ApiOperation({ summary: 'Historical score snapshots for this risk' })
  async getHistory(@CurrentUser() u: AuthenticatedUser, @Param('riskId') riskId: string) {
    return { data: await this.risk.getRiskHistory(u.companyId, riskId), error: null };
  }

  @Patch(':riskId/human-assessment')
  @ApiOperation({ summary: 'Record an engineer\'s manual Probability x Impact Risk Matrix assessment for this risk' })
  async setHumanAssessment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('riskId') riskId: string,
    @Body() dto: SetHumanAssessmentDto,
  ) {
    return { data: await this.risk.setHumanAssessment(u.companyId, pid, riskId, u.id, dto), error: null };
  }

  @Get(':riskId/assessment-history')
  @ApiOperation({ summary: 'Audit trail of human/AI/override Risk Matrix assessments for this risk' })
  async getAssessmentHistory(@CurrentUser() u: AuthenticatedUser, @Param('riskId') riskId: string) {
    return { data: await this.risk.getRiskAssessmentHistory(u.companyId, riskId), error: null };
  }

  @Get(':riskId/ai-explanation')
  @ApiOperation({ summary: 'AI-generated explanation of this risk, grounded in its own factors/evidence/chain -- never a different recommendation than the deterministic one' })
  async getAiExplanation(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('riskId') riskId: string) {
    return { data: await this.risk.generateAiExplanation(u.companyId, pid, riskId), error: null };
  }

  @Patch(':riskId/override')
  @ApiOperation({ summary: 'User override — never silently replaces the automated score, both are preserved' })
  async override(@CurrentUser() u: AuthenticatedUser, @Param('riskId') riskId: string, @Body() dto: OverrideRiskDto) {
    return { data: await this.risk.overrideRisk(u.companyId, riskId, u.id, dto), error: null };
  }

  @Delete(':riskId/override')
  @ApiOperation({ summary: 'Clear a user override, reverting to the automated score' })
  async clearOverride(@CurrentUser() u: AuthenticatedUser, @Param('riskId') riskId: string) {
    return { data: await this.risk.clearOverride(u.companyId, riskId), error: null };
  }

  @Patch(':riskId/status')
  async setStatus(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('riskId') riskId: string, @Body() dto: SetRiskStatusDto) {
    return { data: await this.risk.setStatus(u.companyId, pid, riskId, u.id, dto.status, dto.reason), error: null };
  }

  @Patch(':riskId/owner')
  async assignOwner(@CurrentUser() u: AuthenticatedUser, @Param('riskId') riskId: string, @Body() dto: AssignRiskOwnerDto) {
    return { data: await this.risk.assignOwner(u.companyId, riskId, dto.ownerId ?? null), error: null };
  }
}
