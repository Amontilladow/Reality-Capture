import { AiToolsService, type AssistantContext } from './ai-tools.service';
import type { RfisService } from '../rfis/rfis.service';
import type { IssuesService } from '../issues/issues.service';
import type { SnaggingService } from '../snagging/snagging.service';
import type { RiskService } from '../risk/risk.service';
import type { ProgressReportsService } from '../progress-reports/progress-reports.service';
import type { DocumentsService } from '../documents/documents.service';
import type { ProjectsService } from '../projects/projects.service';
import type { DrawingsService } from '../drawings/drawings.service';
import type { AiClientService } from '../ai-client/ai-client.service';
import type { QaqcService } from '../qaqc/qaqc.service';
import type { SubmittalsService } from '../submittals/submittals.service';
import type { TransmittalsService } from '../transmittals/transmittals.service';
import type { QaService } from '../qa/qa.service';

const ctx: AssistantContext = { companyId: 'company-1', projectId: 'project-1', userId: 'user-1' };

function makeTools() {
  const rfis = { findAll: jest.fn().mockResolvedValue({ data: [] }), findOne: jest.fn().mockResolvedValue({}) };
  const issues = { findAll: jest.fn().mockResolvedValue({ data: [] }), findOne: jest.fn().mockResolvedValue({}) };
  const snagging = {};
  const risk = {};
  const progressReports = {};
  const documents = {};
  const projects = {};
  const drawings = {};
  const aiClient = {};
  const qaqc = { findAll: jest.fn().mockResolvedValue({ data: [] }) };
  const submittals = { findAll: jest.fn().mockResolvedValue({ data: [] }) };
  const transmittals = { findAll: jest.fn().mockResolvedValue({ data: [] }) };
  const qa = { findAll: jest.fn().mockResolvedValue({ data: [] }) };

  const tools = new AiToolsService(
    rfis as unknown as RfisService,
    issues as unknown as IssuesService,
    snagging as unknown as SnaggingService,
    risk as unknown as RiskService,
    progressReports as unknown as ProgressReportsService,
    documents as unknown as DocumentsService,
    projects as unknown as ProjectsService,
    drawings as unknown as DrawingsService,
    aiClient as unknown as AiClientService,
    qaqc as unknown as QaqcService,
    submittals as unknown as SubmittalsService,
    transmittals as unknown as TransmittalsService,
    qa as unknown as QaService,
  );

  return { tools, rfis, issues, qaqc, submittals, transmittals, qa };
}

// CRITICAL regression: these three tools previously called their underlying
// service methods WITHOUT the asking user's id, which silently disables
// RfisService/IssuesService's own subcontractor-isolation check
// (isViewerSubcontractor returns false when viewerId is falsy) -- a
// subcontractor asking the AI assistant could see every other
// subcontractor's RFIs/issues, the exact leak that check exists to prevent
// on the regular REST routes.
describe('AiToolsService — subcontractor isolation is actually passed through', () => {
  it('getOpenRfis passes ctx.userId as the viewer to RfisService.findAll', async () => {
    const { tools, rfis } = makeTools();
    await tools.getOpenRfis(ctx);
    expect(rfis.findAll).toHaveBeenCalledWith('company-1', 'project-1', expect.any(Object), 'user-1');
  });

  it('getRfiDetails passes ctx.userId as the viewer to RfisService.findOne', async () => {
    const { tools, rfis } = makeTools();
    await tools.getRfiDetails(ctx, 'rfi-1');
    expect(rfis.findOne).toHaveBeenCalledWith('company-1', 'project-1', 'rfi-1', 'user-1');
  });

  it('getIssueDetails passes ctx.userId as the viewer to IssuesService.findOne', async () => {
    const { tools, issues } = makeTools();
    await tools.getIssueDetails(ctx, 'issue-1');
    expect(issues.findOne).toHaveBeenCalledWith('company-1', 'project-1', 'issue-1', 'user-1');
  });

  it("getOpenIssues passes ctx.userId as query.userId -- IssuesService.findAll's isolation check reads it from the query object, not a trailing param", async () => {
    const { tools, issues } = makeTools();
    await tools.getOpenIssues(ctx);
    expect(issues.findAll).toHaveBeenCalledWith('company-1', 'project-1', expect.objectContaining({ userId: 'user-1' }));
  });

  it('getOpenSubmittals passes ctx.userId as the viewer to SubmittalsService.findAll', async () => {
    const { tools, submittals } = makeTools();
    await tools.getOpenSubmittals(ctx);
    expect(submittals.findAll).toHaveBeenCalledWith('company-1', 'project-1', expect.any(Object), 'user-1');
  });
});

describe('AiToolsService — new QAQC/Transmittals/QA Inspections tools', () => {
  it('getOpenSors/getOpenWirs/getOpenMirs each query qaqc_records with the right recordType', async () => {
    const { tools, qaqc } = makeTools();
    await tools.getOpenSors(ctx);
    await tools.getOpenWirs(ctx);
    await tools.getOpenMirs(ctx);
    expect(qaqc.findAll).toHaveBeenNthCalledWith(1, 'company-1', 'project-1', expect.objectContaining({ recordType: 'sor' }));
    expect(qaqc.findAll).toHaveBeenNthCalledWith(2, 'company-1', 'project-1', expect.objectContaining({ recordType: 'wir' }));
    expect(qaqc.findAll).toHaveBeenNthCalledWith(3, 'company-1', 'project-1', expect.objectContaining({ recordType: 'mir' }));
  });

  it('getRecentTransmittals does not require (and does not pass) a viewer id -- transmittals have no subcontractor isolation', async () => {
    const { tools, transmittals } = makeTools();
    await tools.getRecentTransmittals(ctx);
    expect(transmittals.findAll).toHaveBeenCalledWith('company-1', 'project-1', expect.any(Object));
  });

  it('getOpenInspections filters to scheduled/in_progress inspections only', async () => {
    const { tools, qa } = makeTools();
    qa.findAll.mockResolvedValue({
      data: [
        { inspectionNumber: 'QAQC-0001', status: 'scheduled' },
        { inspectionNumber: 'QAQC-0002', status: 'passed' },
        { inspectionNumber: 'QAQC-0003', status: 'in_progress' },
      ],
    });
    const result = await tools.getOpenInspections(ctx);
    expect((result.data as Array<{ inspectionNumber: string }>).map((r) => r.inspectionNumber)).toEqual(['QAQC-0001', 'QAQC-0003']);
  });

  it('getOpenSubmittals filters to submitted/under_review submittals only', async () => {
    const { tools, submittals } = makeTools();
    submittals.findAll.mockResolvedValue({
      data: [
        { submittalNumber: 'SUB-0001', status: 'submitted' },
        { submittalNumber: 'SUB-0002', status: 'approved' },
        { submittalNumber: 'SUB-0003', status: 'under_review' },
      ],
    });
    const result = await tools.getOpenSubmittals(ctx);
    expect((result.data as Array<{ submittalNumber: string }>).map((r) => r.submittalNumber)).toEqual(['SUB-0001', 'SUB-0003']);
  });
});
