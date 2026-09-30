import { Body, Controller, Get, Param, Patch, Post, Query, Delete } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@engineeringos/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RiskService } from './risk.service';
import { RiskGraphService } from './risk-graph.service';
import { OverrideRiskDto } from './dto/override-risk.dto';
import { SetRiskStatusDto } from './dto/set-risk-status.dto';
import { AssignRiskOwnerDto } from './dto/assign-risk-owner.dto';

@ApiTags('risk')
@ApiBearerAuth()
@Controller('projects/:projectId/risk')
export class RiskController {
  constructor(
    private readonly risk: RiskService,
    private readonly graph: RiskGraphService,
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

  @Get('graph')
  @ApiOperation({ summary: 'Bounded graph neighborhood for the Risk Graph visualization' })
  async getGraph(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query('rootNodeId') rootNodeId?: string,
    @Query('maxDepth') maxDepth?: string,
  ) {
    if (rootNodeId) {
      const neighborhood = await this.graph.getNeighborhood(u.companyId, rootNodeId, { maxDepth: maxDepth ? Number(maxDepth) : undefined });
      return { data: neighborhood, error: null };
    }
    const nodes = await this.graph.getNodesByProject(u.companyId, pid);
    return { data: { nodes, edges: [] }, error: null };
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
