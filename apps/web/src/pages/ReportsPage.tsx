import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { DRAWING_UPDATE_STATUS_LABELS } from '@engineeringos/types';
import { PageHeader } from '../components/layout/PageHeader';
import { HelpLink } from '../components/help/HelpLink';
import { StatTile } from '../components/ui/StatTile';
import { SectionHeader } from '../components/ui/SectionHeader';
import { getReportKpis, getReportsBriefing } from '../lib/reports.api';
import { downloadReportsXls } from '../lib/reports-xls';
import { getProject } from '../lib/projects.api';
import { listDocuments, uploadDocumentFile } from '../lib/documents.api';
import { remindRfiDrawingUpdate } from '../lib/rfis.api';
import { getRiskSummary, getTopRisks, downloadRiskPdf, type RiskLevel } from '../lib/risk.api';
import { apiErrorMessage, apiDownload } from '../lib/api';
import {
  STATUS_LABELS, PRIORITY_LABELS, DISCIPLINE_LABELS, formatDateTime,
} from '../lib/issue-constants';
import { SNAG_STATUS_LABELS, SNAG_PRIORITY_LABELS } from '../lib/snagging-constants';
import { QAQC_STATUS_LABELS, QAQC_RECORD_TYPE_SHORT_LABELS } from '../lib/qaqc-constants';
import type { QaqcStatus, QaqcRecordType } from '../lib/qaqc.api';
import { useThemeColors, type ThemeColors } from '../lib/useThemeColors';
import { StatusBadge } from '../components/ui/Badge';
import {
  buildSignals, deriveOverallStatus, buildConclusion,
  SEVERITY_TONE, SEVERITY_LABEL, STATUS_LABEL, STATUS_TONE,
} from '../lib/executive-signals';

// One-line lead for each report section, so the reader gets the
// implication before the stat-tile wall and tables below it (Phase 4:
// "lead with implication, not a status table"). Pure prose over numbers
// this page already fetched -- no new calculation, no invented thresholds.
function sectionLead(total: number, flags: { label: string; count: number }[], noun: string): string {
  if (total === 0) return `No ${noun} logged on this project yet.`;
  const flagged = flags.filter((f) => f.count > 0);
  if (flagged.length === 0) return `${total} ${noun} tracked — none critical or overdue.`;
  const parts = flagged.map((f) => `${f.count} ${f.label}`);
  return `${parts.join(' and ')} out of ${total} ${noun} need attention.`;
}

// Recharts marks need real hex/rgb colors -- they don't inherit Tailwind
// classes -- resolved from the same --rc-* custom properties every
// Tailwind utility class in the app resolves (useThemeColors(), called
// once per component below), so this page's charts read as the same
// product as the badges on the Issues/Snagging tabs themselves, in
// whichever theme is active. A fixed, non-themed orange rounds out the
// rotating series palette purely for visual variety (chart-only, not a
// semantic UI color), same reasoning as RiskIntelligenceSection.tsx's
// HIGH_HEX/VERY_HIGH_HEX constants.
const SERIES_ACCENT_HEX = '#FF7A29';

// Mirrors STATUS_BADGE_CLASS / SNAG_STATUS_BADGE_CLASS's own color choices
// (issue-constants.ts / snagging-constants.ts) so a given status reads as
// the same color here as it does on the live tabs.
function issueStatusColors(c: ThemeColors): Record<string, string> {
  return {
    open: c.blueprint,
    assigned: c.warn,
    in_progress: c.warn,
    under_review: c.warn,
    waiting_for_information: c.warn,
    resolved: c.ok,
    closed: c['ink-500'],
    reopened: c.danger,
    void: c['ink-500'],
  };
}

function priorityColors(c: ThemeColors): Record<string, string> {
  return { critical: c.danger, high: c.danger, medium: c.warn, low: c['ink-500'] };
}

function snagStatusColors(c: ThemeColors): Record<string, string> {
  return { open: c.danger, fixed: c.warn, verified: c.ok, void: c['ink-500'] };
}

// Mirrors RiskIntelligenceSection.tsx's own levelColors() exactly -- the
// 0-100/4-level deterministic-engine palette, never the separate 1-25
// Risk Matrix one (this page never shows Risk Matrix numbers). HIGH has no
// dedicated semantic token -- see that file's identical reasoning.
function riskLevelColors(c: ThemeColors): Record<RiskLevel, string> {
  return { LOW: c.ok, MODERATE: c.warn, HIGH: '#FB923C', CRITICAL: c.danger };
}

// Rotating palette for axes with no fixed status/priority meaning
// (discipline, trade) -- reuses the same accent colors as everything else
// on this page instead of inventing a new chart palette.
function seriesPalette(c: ThemeColors): string[] {
  return [c.blueprint, SERIES_ACCENT_HEX, c.ok, c.warn, c.danger, c['ink-500']];
}

function countsToChartData(counts: Record<string, number>, labelFor: (key: string) => string) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, name: labelFor(key), value: count }));
}

function tooltipStyle(c: ThemeColors) {
  return {
    background: c['base-800'],
    border: `1px solid ${c['base-700']}`,
    borderRadius: 4,
    fontSize: 12,
    color: c['ink-100'],
  };
}

export default function ReportsPage() {
  const themeColors = useThemeColors();
  const ISSUE_STATUS_COLORS = issueStatusColors(themeColors);
  const PRIORITY_COLORS = priorityColors(themeColors);
  const SNAG_STATUS_COLORS = snagStatusColors(themeColors);
  const RISK_LEVEL_COLORS = riskLevelColors(themeColors);
  const SERIES_PALETTE = seriesPalette(themeColors);
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const kpisQuery = useQuery({
    queryKey: ['report-kpis', projectId],
    queryFn: () => getReportKpis(projectId!),
    enabled: Boolean(projectId),
  });

  const documentsQuery = useQuery({
    queryKey: ['documents', projectId, 'report_attachment'],
    queryFn: () => listDocuments(projectId!, { perPage: 100, docType: 'report_attachment' }),
    enabled: Boolean(projectId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocumentFile(projectId!, file, { docType: 'report_attachment', title: file.name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', projectId, 'report_attachment'] });
    },
  });

  // Risk Intelligence lives on its own top-level tab (moved out of Reports
  // per an earlier, explicit decision) -- this just surfaces its headline
  // numbers here too, with a link to the full page and a download button
  // for the SAME PDF export that page already offers, never a second
  // generator for the same data (Phase 22).
  const riskSummaryQuery = useQuery({
    queryKey: ['risk-summary', projectId],
    queryFn: () => getRiskSummary(projectId!),
    enabled: Boolean(projectId),
  });
  const topRisksQuery = useQuery({
    queryKey: ['risk-top', projectId],
    queryFn: () => getTopRisks(projectId!, 3),
    enabled: Boolean(projectId),
  });

  // AI Report Briefing -- on-demand only (never auto-fetched), same pattern
  // as RiskIntelligenceSection's "AI Project Risk Briefing".
  const aiBriefingMutation = useMutation({ mutationFn: () => getReportsBriefing(projectId!) });

  // The "one click" the ticket asked for: clicking the not-applied stat tile
  // expands this list inline, right on the Reports page -- following up
  // never requires leaving it. remindedIds tracks which rows already got a
  // reminder this session so the button can say "Sent" instead of silently
  // going back to "Send reminder" after a successful call.
  const [drawingListOpen, setDrawingListOpen] = useState(false);
  const [remindedIds, setRemindedIds] = useState<Set<string>>(new Set());
  const remindMutation = useMutation({
    mutationFn: (rfiId: string) => remindRfiDrawingUpdate(projectId!, rfiId),
    onSuccess: (_data, rfiId) => setRemindedIds((prev) => new Set(prev).add(rfiId)),
  });

  const [xlsError, setXlsError] = useState('');
  const [xlsDownloading, setXlsDownloading] = useState(false);
  async function handleDownloadXls() {
    if (!kpisQuery.data) return;
    setXlsError('');
    setXlsDownloading(true);
    try {
      await downloadReportsXls(kpisQuery.data, projectQuery.data?.code ?? projectId!);
    } catch (err) {
      setXlsError(apiErrorMessage(err));
    } finally {
      setXlsDownloading(false);
    }
  }

  const [pdfError, setPdfError] = useState('');
  const [pdfDownloading, setPdfDownloading] = useState(false);
  async function handleDownloadPdf() {
    if (!projectId) return;
    setPdfError('');
    setPdfDownloading(true);
    try {
      await apiDownload(`/projects/${projectId}/reports/pdf`, `${projectQuery.data?.code ?? projectId}-report.pdf`);
    } catch (err) {
      setPdfError(apiErrorMessage(err));
    } finally {
      setPdfDownloading(false);
    }
  }

  const [riskPdfError, setRiskPdfError] = useState('');
  const [riskPdfDownloading, setRiskPdfDownloading] = useState(false);
  async function handleDownloadRiskPdf() {
    if (!projectId) return;
    setRiskPdfError('');
    setRiskPdfDownloading(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadRiskPdf(projectId, `${projectQuery.data?.code ?? projectId}-risk-report-${date}.pdf`);
    } catch (err) {
      setRiskPdfError(apiErrorMessage(err));
    } finally {
      setRiskPdfDownloading(false);
    }
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = '';
  }

  if (!projectId) return null;

  const kpis = kpisQuery.data;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="Reports"
        actions={
          <div className="flex items-center gap-3">
            <HelpLink slug="understanding-available-kpis" label="Understanding these KPIs" />
            <button onClick={handleDownloadXls} disabled={!kpis || xlsDownloading} className="btn-secondary">
              {xlsDownloading ? 'Preparing…' : 'Export as Excel'}
            </button>
            <button onClick={handleDownloadPdf} disabled={pdfDownloading} className="btn-primary">
              {pdfDownloading ? 'Preparing…' : 'Export as PDF'}
            </button>
          </div>
        }
      />

      <div className="p-6 space-y-8">
        {(xlsError || pdfError) && (
          <div className="space-y-1">
            {xlsError && <p className="field-error">{xlsError}</p>}
            {pdfError && <p className="field-error">{pdfError}</p>}
          </div>
        )}

        {/* ── Report conclusion (Minto Pyramid: lead with this, the
            charts/tables below are the evidence layer) — built from the
            exact same risk summary + KPI data the sections below already
            fetched, never a second calculation. ───────────────────────── */}
        {riskSummaryQuery.data && kpis && (() => {
          const signals = buildSignals(`/projects/${projectId}`, {
            risk: { criticalCount: riskSummaryQuery.data!.criticalCount, overdueCount: riskSummaryQuery.data!.overdueCount },
            issues: { critical: kpis.issues.summary.critical, overdue: kpis.issues.summary.overdue },
            rfis: { overdue: kpis.rfis.summary.overdue },
            qaqc: { critical: kpis.qaqc.summary.critical, overdue: kpis.qaqc.summary.overdue },
            snagging: { overdue: kpis.snagging.summary.overdue },
          });
          const hasActivity = riskSummaryQuery.data!.totalOpenRisks > 0 || kpis.issues.summary.total > 0
            || kpis.rfis.summary.total > 0 || kpis.qaqc.summary.total > 0 || kpis.snagging.summary.total > 0;
          const status = deriveOverallStatus(signals, hasActivity);
          const conclusion = buildConclusion(status, signals, 'on this project');
          return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="panel tick-frame p-5 space-y-2">
                <div className="flex items-center gap-2.5">
                  <StatusBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} dot />
                  {signals.length > 0 && (
                    <span className="text-xs text-ink-500">
                      {signals.length} item{signals.length === 1 ? '' : 's'} flagged below
                    </span>
                  )}
                </div>
                <p className="text-base text-ink-100 leading-relaxed font-medium">{conclusion}</p>
                {signals.length > 1 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {signals.slice(0, 4).map((s, i) => (
                      <StatusBadge key={i} tone={SEVERITY_TONE[s.severity]} label={`${SEVERITY_LABEL[s.severity]} · ${s.domain}`} />
                    ))}
                  </div>
                )}
              </section>

              {/* AI Report Briefing — an LLM-polished Conclusion/Drivers/
                  Impact/Action/Evidence structure, generated on demand from
                  the exact same computed data above, never a fresh
                  retrieval. Same pattern as RiskIntelligenceSection's own
                  AI panel: clearly labeled, never auto-fetched, honest
                  unavailable+reason fallback. */}
              <div className="panel p-4">
                <div className="!mb-2">
                  <SectionHeader
                    title="AI Report Briefing"
                    tone="orange"
                    size="sm"
                    actions={
                      <button onClick={() => aiBriefingMutation.mutate()} disabled={aiBriefingMutation.isPending} className="btn-secondary !px-2.5 !py-1 text-xs">
                        {aiBriefingMutation.isPending ? 'Generating…' : aiBriefingMutation.data ? 'Regenerate' : 'Generate'}
                      </button>
                    }
                  />
                </div>
                {aiBriefingMutation.isError && <p className="field-error">{apiErrorMessage(aiBriefingMutation.error)}</p>}
                {aiBriefingMutation.data && 'unavailable' in aiBriefingMutation.data && (
                  <p className="text-sm text-ink-500 italic">{aiBriefingMutation.data.reason}</p>
                )}
                {aiBriefingMutation.data && 'conclusion' in aiBriefingMutation.data && (
                  <div className="space-y-2 text-sm">
                    <p className="text-ink-100 font-medium">{aiBriefingMutation.data.conclusion}</p>
                    {aiBriefingMutation.data.drivers.length > 0 && (
                      <ul className="list-disc list-inside text-ink-300 space-y-0.5">
                        {aiBriefingMutation.data.drivers.map((d, i) => <li key={i}>{d}</li>)}
                      </ul>
                    )}
                    {aiBriefingMutation.data.impact && <p className="text-ink-300"><span className="text-ink-500">Impact: </span>{aiBriefingMutation.data.impact}</p>}
                    {aiBriefingMutation.data.action && <p className="text-ink-300"><span className="text-ink-500">Action: </span>{aiBriefingMutation.data.action}</p>}
                    {aiBriefingMutation.data.evidence.length > 0 && (
                      <p className="text-xs text-ink-500">Evidence: {aiBriefingMutation.data.evidence.join(' · ')}</p>
                    )}
                  </div>
                )}
                {!aiBriefingMutation.data && !aiBriefingMutation.isPending && (
                  <p className="text-xs text-ink-500">Generate an AI-polished Conclusion / Drivers / Impact / Action / Evidence briefing from the data above.</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Risk ───────────────────────────────────────────────────── */}
        {riskSummaryQuery.data && (
          <section className="space-y-4">
            <SectionHeader
              title="Risk"
              actions={
                <>
                  <Link to={`/projects/${projectId}/risk`} className="btn-secondary !px-3 !py-1.5 text-xs">
                    View full Risk Intelligence →
                  </Link>
                  <button
                    onClick={handleDownloadRiskPdf}
                    disabled={riskPdfDownloading || riskSummaryQuery.data.totalOpenRisks === 0}
                    className="btn-secondary !px-3 !py-1.5 text-xs"
                  >
                    {riskPdfDownloading ? 'Preparing…' : 'Download Risk Report'}
                  </button>
                </>
              }
            />
            {riskPdfError && <p className="field-error">{riskPdfError}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div className="panel p-3">
                <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-0.5">Project Risk Index</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold tabular-nums" style={{ color: RISK_LEVEL_COLORS[riskSummaryQuery.data.overallLevel] }}>
                    {riskSummaryQuery.data.overallScore}
                  </span>
                  <span className="text-xs text-ink-500">/ 100 · {riskSummaryQuery.data.overallLevel}</span>
                </div>
              </div>
              <StatTile label="Critical Risks" value={riskSummaryQuery.data.criticalCount} tone="danger" />
              <StatTile label="Overdue Items" value={riskSummaryQuery.data.overdueCount} tone="danger" />
              <StatTile label="Open Discrepancies" value={riskSummaryQuery.data.openDiscrepancyCount} />
              <StatTile label="Total Open Risks" value={riskSummaryQuery.data.totalOpenRisks} />
            </div>
            {(topRisksQuery.data?.length ?? 0) > 0 && (
              <div className="panel tick-frame divide-y divide-base-700/60">
                {(topRisksQuery.data ?? []).map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-ink-100">{r.title}</span>
                    <span className="tabular-nums" style={{ color: RISK_LEVEL_COLORS[r.level] }}>{r.score}/100</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {kpisQuery.isLoading && <p className="text-sm text-ink-500">Loading report data…</p>}
        {kpisQuery.isError && <p className="field-error">{apiErrorMessage(kpisQuery.error)}</p>}

        {kpis && (
          <>
            {/* ── Issues ─────────────────────────────────────────────── */}
            <section className="space-y-4">
              <SectionHeader title="Issues" />
              <p className="text-sm text-ink-300">
                {sectionLead(kpis.issues.summary.total, [
                  { label: 'critical', count: kpis.issues.summary.critical },
                  { label: 'overdue', count: kpis.issues.summary.overdue },
                ], 'issues')}
              </p>

              <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
                <StatTile label="Total" value={kpis.issues.summary.total} />
                <StatTile label="Open" value={kpis.issues.summary.open} />
                <StatTile label="In Progress" value={kpis.issues.summary.inProgress} />
                <StatTile label="Resolved" value={kpis.issues.summary.resolved} />
                <StatTile label="Closed" value={kpis.issues.summary.closed} />
                <StatTile label="Critical" value={kpis.issues.summary.critical} tone="danger" />
                <StatTile label="Overdue" value={kpis.issues.summary.overdue} tone="danger" />
              </div>

              {kpis.issues.summary.total === 0 ? (
                <div className="panel tick-frame p-10 text-center text-sm text-ink-500">
                  No issues logged on this project yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <ChartCard title="By status">
                    <StatusPieChart data={countsToChartData(kpis.issues.byStatus, (k) => STATUS_LABELS[k as keyof typeof STATUS_LABELS] ?? k)} colorFor={(k) => ISSUE_STATUS_COLORS[k] ?? themeColors['ink-500']} />
                  </ChartCard>
                  <ChartCard title="By priority">
                    <CountBarChart data={countsToChartData(kpis.issues.byPriority, (k) => PRIORITY_LABELS[k as keyof typeof PRIORITY_LABELS] ?? k)} colorFor={(k) => PRIORITY_COLORS[k] ?? themeColors.blueprint} />
                  </ChartCard>
                  <ChartCard title="By discipline">
                    <CountBarChart data={countsToChartData(kpis.issues.byDiscipline, (k) => DISCIPLINE_LABELS[k as keyof typeof DISCIPLINE_LABELS] ?? k)} colorFor={(_k, i) => SERIES_PALETTE[i % SERIES_PALETTE.length]} />
                  </ChartCard>
                </div>
              )}

              {kpis.issues.openList.length > 0 && (
                <div className="panel tick-frame overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                        <th className="px-4 py-2.5 font-medium">Number</th>
                        <th className="px-4 py-2.5 font-medium">Title</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Priority</th>
                        <th className="px-4 py-2.5 font-medium">Assigned to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpis.issues.openList.map((item) => (
                        <tr key={item.id} className="border-b border-base-700/60 last:border-0">
                          <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{item.issueNumber ?? item.id.slice(0, 8)}</td>
                          <td className="px-4 py-2.5">{item.title}</td>
                          <td className="px-4 py-2.5 text-ink-300">{STATUS_LABELS[item.status as keyof typeof STATUS_LABELS] ?? item.status}</td>
                          <td className="px-4 py-2.5 text-ink-300">{PRIORITY_LABELS[item.priority as keyof typeof PRIORITY_LABELS] ?? item.priority}</td>
                          <td className="px-4 py-2.5 text-ink-500">{item.assignedToName ?? 'Unassigned'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ── Snagging ───────────────────────────────────────────── */}
            <section className="space-y-4">
              <SectionHeader title="Snagging" />
              <p className="text-sm text-ink-300">
                {sectionLead(kpis.snagging.summary.total, [
                  { label: 'overdue', count: kpis.snagging.summary.overdue },
                ], 'snag items')}
              </p>

              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                <StatTile label="Total" value={kpis.snagging.summary.total} />
                <StatTile label="Open" value={kpis.snagging.summary.open} />
                <StatTile label="Fixed" value={kpis.snagging.summary.fixed} />
                <StatTile label="Verified" value={kpis.snagging.summary.verified} />
                <StatTile label="Overdue" value={kpis.snagging.summary.overdue} tone="danger" />
              </div>

              {kpis.snagging.summary.total === 0 ? (
                <div className="panel tick-frame p-10 text-center text-sm text-ink-500">
                  No snag items logged on this project yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <ChartCard title="By status">
                    <StatusPieChart data={countsToChartData(kpis.snagging.byStatus, (k) => SNAG_STATUS_LABELS[k as keyof typeof SNAG_STATUS_LABELS] ?? k)} colorFor={(k) => SNAG_STATUS_COLORS[k] ?? themeColors['ink-500']} />
                  </ChartCard>
                  <ChartCard title="By priority">
                    <CountBarChart data={countsToChartData(kpis.snagging.byPriority, (k) => SNAG_PRIORITY_LABELS[k as keyof typeof SNAG_PRIORITY_LABELS] ?? k)} colorFor={(k) => PRIORITY_COLORS[k] ?? themeColors.blueprint} />
                  </ChartCard>
                  <ChartCard title="By trade">
                    <CountBarChart data={countsToChartData(kpis.snagging.byTrade, (k) => k)} colorFor={(_k, i) => SERIES_PALETTE[i % SERIES_PALETTE.length]} />
                  </ChartCard>
                </div>
              )}

              {kpis.snagging.openList.length > 0 && (
                <div className="panel tick-frame overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                        <th className="px-4 py-2.5 font-medium">Number</th>
                        <th className="px-4 py-2.5 font-medium">Title</th>
                        <th className="px-4 py-2.5 font-medium">Trade</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Priority</th>
                        <th className="px-4 py-2.5 font-medium">Assigned to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpis.snagging.openList.map((item) => (
                        <tr key={item.id} className="border-b border-base-700/60 last:border-0">
                          <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{item.snagNumber ?? item.id.slice(0, 8)}</td>
                          <td className="px-4 py-2.5">{item.title}</td>
                          <td className="px-4 py-2.5 text-ink-300">{item.trade ?? '—'}</td>
                          <td className="px-4 py-2.5 text-ink-300">{SNAG_STATUS_LABELS[item.status as keyof typeof SNAG_STATUS_LABELS] ?? item.status}</td>
                          <td className="px-4 py-2.5 text-ink-300">{SNAG_PRIORITY_LABELS[item.priority as keyof typeof SNAG_PRIORITY_LABELS] ?? item.priority}</td>
                          <td className="px-4 py-2.5 text-ink-500">{item.assignedToName ?? 'Unassigned'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ── RFIs ───────────────────────────────────────────────── */}
            <section className="space-y-4">
              <SectionHeader title="RFIs" />
              <p className="text-sm text-ink-300">
                {sectionLead(kpis.rfis.summary.total, [
                  { label: 'overdue', count: kpis.rfis.summary.overdue },
                ], 'RFIs')}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <StatTile label="Total" value={kpis.rfis.summary.total} />
                <StatTile label="Open" value={kpis.rfis.summary.open} />
                <StatTile label="Overdue" value={kpis.rfis.summary.overdue} tone="danger" />
                {/* The "one click" -- clicking this tile expands the
                    not-applied list below, right on this page. */}
                <button
                  type="button"
                  onClick={() => setDrawingListOpen((v) => !v)}
                  className="panel p-3 text-left hover:bg-base-800/60 transition-colors"
                >
                  <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-0.5">Drawing/Model Updated — Applied</div>
                  <div className={`text-xl font-semibold tabular-nums ${kpis.rfis.drawingUpdateStatus.notApplied > 0 ? 'text-warn' : 'text-ink-100'}`}>
                    {kpis.rfis.drawingUpdateStatus.applied} of {kpis.rfis.drawingUpdateStatus.totalRequiringDrawingUpdate}
                  </div>
                </button>
              </div>

              {kpis.rfis.summary.total === 0 ? (
                <div className="panel tick-frame p-10 text-center text-sm text-ink-500">
                  No RFIs logged on this project yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ChartCard title="By Drawing/Model Updated status">
                    <CountBarChart
                      data={countsToChartData(kpis.rfis.byDrawingImpact, (k) => DRAWING_UPDATE_STATUS_LABELS[k as keyof typeof DRAWING_UPDATE_STATUS_LABELS] ?? k)}
                      colorFor={(_k, i) => SERIES_PALETTE[i % SERIES_PALETTE.length]}
                    />
                  </ChartCard>
                  <div className="panel p-4">
                    <div className="field-label !mb-2">Drawing update follow-up</div>
                    <div className="flex items-center justify-center h-[220px]">
                      <div className="text-center">
                        <div className="text-3xl font-semibold tabular-nums text-ink-100">
                          {kpis.rfis.drawingUpdateStatus.notApplied}
                        </div>
                        <div className="text-xs text-ink-500 mt-1">not yet applied</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {drawingListOpen && (
                <div className="panel tick-frame overflow-hidden">
                  {kpis.rfis.notAppliedList.length === 0 ? (
                    <div className="p-8 text-center text-sm text-ink-500">
                      Every RFI requiring a drawing update has been applied.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                          <th className="px-4 py-2.5 font-medium">Number</th>
                          <th className="px-4 py-2.5 font-medium">Subject</th>
                          <th className="px-4 py-2.5 font-medium">Owner</th>
                          <th className="px-4 py-2.5 font-medium">Days flagged</th>
                          <th className="px-4 py-2.5 font-medium" />
                        </tr>
                      </thead>
                      <tbody>
                        {kpis.rfis.notAppliedList.map((item) => {
                          const daysFlagged = Math.max(0, Math.floor((Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
                          const isSending = remindMutation.isPending && remindMutation.variables === item.id;
                          const wasSent = remindedIds.has(item.id);
                          return (
                            <tr key={item.id} className="border-b border-base-700/60 last:border-0">
                              <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{item.rfiNumber ?? item.id.slice(0, 8)}</td>
                              <td className="px-4 py-2.5">{item.subject}</td>
                              <td className="px-4 py-2.5 text-ink-300">{item.drawingUpdateOwnerName ?? 'Unassigned'}</td>
                              <td className="px-4 py-2.5 text-ink-300">{daysFlagged}</td>
                              <td className="px-4 py-2.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => remindMutation.mutate(item.id)}
                                  disabled={isSending}
                                  className="btn-secondary !px-2.5 !py-1 text-xs"
                                >
                                  {isSending ? 'Sending…' : wasSent ? 'Sent' : 'Send reminder'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  {remindMutation.isError && <p className="field-error p-3">{apiErrorMessage(remindMutation.error)}</p>}
                </div>
              )}
            </section>

            {/* ── QAQC (NCR/SOR/WIR/MIR) ──────────────────────────────── */}
            <section className="space-y-4">
              <SectionHeader title="QAQC — NCR, SOR, WIR & MIR" />
              <p className="text-sm text-ink-300">
                {sectionLead(kpis.qaqc.summary.total, [
                  { label: 'critical', count: kpis.qaqc.summary.critical },
                  { label: 'overdue', count: kpis.qaqc.summary.overdue },
                ], 'QA/QC records')}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <StatTile label="Pending Confirmation" value={kpis.qaqc.summary.pendingConfirmation} />
                <StatTile label="Critical" value={kpis.qaqc.summary.critical} tone="danger" />
                <StatTile label="Overdue" value={kpis.qaqc.summary.overdue} tone="danger" />
                <StatTile label="Total" value={kpis.qaqc.summary.total} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="panel p-3">
                  <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-0.5">NCR — Open / Total / Closed</div>
                  <div className="text-xl font-semibold tabular-nums text-ink-100">{kpis.qaqc.summary.ncrOpen} / {kpis.qaqc.summary.ncrTotal} / {kpis.qaqc.summary.ncrClosed}</div>
                </div>
                <div className="panel p-3">
                  <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-0.5">SOR — Open / Total / Closed</div>
                  <div className="text-xl font-semibold tabular-nums text-ink-100">{kpis.qaqc.summary.sorOpen} / {kpis.qaqc.summary.sorTotal} / {kpis.qaqc.summary.sorClosed}</div>
                </div>
                <div className="panel p-3">
                  <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-0.5">WIR — Open / Total / Closed</div>
                  <div className="text-xl font-semibold tabular-nums text-ink-100">{kpis.qaqc.summary.wirOpen} / {kpis.qaqc.summary.wirTotal} / {kpis.qaqc.summary.wirClosed}</div>
                </div>
                <div className="panel p-3">
                  <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-0.5">MIR — Open / Total / Closed</div>
                  <div className="text-xl font-semibold tabular-nums text-ink-100">{kpis.qaqc.summary.mirOpen} / {kpis.qaqc.summary.mirTotal} / {kpis.qaqc.summary.mirClosed}</div>
                </div>
              </div>

              {kpis.qaqc.summary.total === 0 ? (
                <div className="panel tick-frame p-10 text-center text-sm text-ink-500">
                  No NCR/SOR/WIR/MIR records logged on this project yet.
                </div>
              ) : kpis.qaqc.openList.length > 0 && (
                <div className="panel tick-frame overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                        <th className="px-4 py-2.5 font-medium">Number</th>
                        <th className="px-4 py-2.5 font-medium">Type</th>
                        <th className="px-4 py-2.5 font-medium">Subject</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Priority</th>
                        <th className="px-4 py-2.5 font-medium">Assigned to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpis.qaqc.openList.map((item) => (
                        <tr key={item.id} className="border-b border-base-700/60 last:border-0">
                          <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{item.recordNumber ?? item.id.slice(0, 8)}</td>
                          <td className="px-4 py-2.5 uppercase text-ink-300">{QAQC_RECORD_TYPE_SHORT_LABELS[item.recordType as QaqcRecordType] ?? item.recordType}</td>
                          <td className="px-4 py-2.5">{item.subject}</td>
                          <td className="px-4 py-2.5 text-ink-300">{QAQC_STATUS_LABELS[item.status as QaqcStatus] ?? item.status}</td>
                          <td className="px-4 py-2.5 text-ink-300">{PRIORITY_LABELS[item.priority as keyof typeof PRIORITY_LABELS] ?? item.priority}</td>
                          <td className="px-4 py-2.5 text-ink-500">{item.assignedToName ?? 'Unassigned'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {/* ── Uploaded documents ───────────────────────────────────────── */}
        <section className="space-y-4">
          <SectionHeader
            title="Uploaded documents"
            actions={
              <>
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChosen} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadMutation.isPending}
                  className="btn-secondary !px-3 !py-1.5 text-xs"
                >
                  {uploadMutation.isPending ? 'Uploading…' : '+ Upload attachment'}
                </button>
              </>
            }
          />

          {uploadMutation.isError && <p className="field-error">{apiErrorMessage(uploadMutation.error)}</p>}

          {documentsQuery.isLoading && <p className="text-sm text-ink-500">Loading…</p>}

          {documentsQuery.data?.data.length === 0 && !documentsQuery.isLoading && (
            <div className="tick-frame panel p-8 text-center text-sm text-ink-500">
              No report attachments uploaded yet.
            </div>
          )}

          {(documentsQuery.data?.data.length ?? 0) > 0 && (
            <div className="panel tick-frame overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                    <th className="px-4 py-2.5 font-medium">Title</th>
                    <th className="px-4 py-2.5 font-medium">Uploaded by</th>
                    <th className="px-4 py-2.5 font-medium">Uploaded at</th>
                  </tr>
                </thead>
                <tbody>
                  {(documentsQuery.data?.data ?? []).map((d) => (
                    <tr key={d.id} className="border-b border-base-700/60 last:border-0">
                      <td className="px-4 py-2.5">{d.title}</td>
                      <td className="px-4 py-2.5 text-ink-500">{(d as unknown as { uploadedByName?: string }).uploadedByName ?? '—'}</td>
                      <td className="px-4 py-2.5 text-ink-500">{formatDateTime(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="field-label !mb-2">{title}</div>
      <div style={{ width: '100%', height: 220 }}>{children}</div>
    </div>
  );
}

function StatusPieChart({ data, colorFor }: { data: { key: string; name: string; value: number }[]; colorFor: (key: string) => string }) {
  const themeColors = useThemeColors();
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} paddingAngle={2}>
          {data.map((entry) => (
            <Cell key={entry.key} fill={colorFor(entry.key)} stroke={themeColors['base-800']} strokeWidth={1} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle(themeColors)} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function CountBarChart({ data, colorFor }: { data: { key: string; name: string; value: number }[]; colorFor: (key: string, index: number) => string }) {
  const themeColors = useThemeColors();
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={themeColors['base-700']} vertical={false} />
        <XAxis dataKey="name" tick={{ fill: themeColors['ink-500'], fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
        <YAxis tick={{ fill: themeColors['ink-500'], fontSize: 10 }} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle(themeColors)} cursor={{ fill: 'rgba(79,182,232,0.08)' }} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={entry.key} fill={colorFor(entry.key, i)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyChart() {
  return <div className="h-full flex items-center justify-center text-xs text-ink-500">No data</div>;
}
