import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { Modal } from './ui/Modal';
import { SectionHeader } from './ui/SectionHeader';
import { RiskGraphView } from './RiskGraphView';
import { RiskKpiStrip } from './risk/RiskKpiStrip';
import { RiskAttentionPanel } from './risk/RiskAttentionPanel';
import { RiskMovementSection } from './risk/RiskMovementSection';
import { RiskHeatmap } from './risk/RiskHeatmap';
import { RiskDisciplineChart } from './risk/RiskDisciplineChart';
import { RiskRegisterTable } from './risk/RiskRegisterTable';
import {
  DEFAULT_REGISTER_FILTERS, dueDateTone, formatDueDate, isOpenRiskStatus, ownerNameMap,
  type RegisterFilters,
} from './risk/riskDisplay';
import { apiErrorMessage } from '../lib/api';
import { getProject, getMembers, type ProjectMember } from '../lib/projects.api';
import { useThemeColors, type ThemeColors } from '../lib/useThemeColors';
import {
  recalculateRisk, getRiskSummary, getTopRisks, getEmergingRisks, getRiskByDiscipline,
  getRiskClusters, getRiskDataAvailability, listRisks, getRisk, getRiskChain, getRiskEvidence, getRiskHistory,
  overrideRisk, clearRiskOverride, setRiskStatus, getAiBriefing, getAiExplanation, downloadRiskPdf,
  setHumanAssessment, setHumanAssessmentByEntity, setMatrixOverride, getRiskByEntity, assignRiskOwner, setRiskDueDate,
  getMatrixDiscrepancies, getRiskHeatmap, getRiskMovement, RISK_DRIVERS, RISK_DRIVER_LABELS,
  type Risk, type RiskLevel, type RiskStatus, type RiskMatrixLevel, type RiskDriver, type RiskMatrixDiscrepancy,
} from '../lib/risk.api';
import { Listbox } from './ui/Listbox';

// HIGH/VERY_HIGH have no dedicated semantic token (the design system only
// has a 3-step ok/warn/danger scale) -- these two literal oranges sit
// between warn and danger in both hue and severity and already read
// clearly on both a light and a dark surface (mid-brightness, not washed
// out either direction), so they're left as fixed constants rather than
// invented tokens for a single consumer.
const HIGH_HEX = '#FB923C';
const VERY_HIGH_HEX = '#F97316';

// Every other color below comes from useThemeColors() (resolves the same
// --rc-* custom properties every Tailwind utility class in the app
// resolves) -- built as functions of the resolved colors, called once per
// component via useThemeColors(), rather than module-level constants, so
// every chart and badge here re-renders with the right colors when the
// theme changes.
function levelColors(colors: ThemeColors): Record<RiskLevel, string> {
  return { LOW: colors.ok, MODERATE: colors.warn, HIGH: HIGH_HEX, CRITICAL: colors.danger };
}

const LEVEL_LABELS: Record<RiskLevel, string> = {
  LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High', CRITICAL: 'Critical',
};

const STATUS_LABELS: Record<RiskStatus, string> = {
  DETECTED: 'Detected', ACTIVE: 'Active', MITIGATION_IN_PROGRESS: 'Mitigation in progress',
  MONITORING: 'Monitoring', ACCEPTED: 'Accepted', ESCALATED: 'Escalated',
  RESOLVED: 'Resolved', CLOSED: 'Closed',
};

// Risk Matrix (1-25, 5-level) -- deliberately a different palette/label set
// from levelColors()/LEVEL_LABELS above, which belong to the 0-100/4-level
// deterministic engine score. Never mix the two scales in one place.
function matrixLevelColors(colors: ThemeColors): Record<RiskMatrixLevel, string> {
  return { LOW: colors.ok, MEDIUM: colors.warn, HIGH: HIGH_HEX, VERY_HIGH: VERY_HIGH_HEX, CRITICAL: colors.danger };
}
const MATRIX_LEVEL_LABELS: Record<RiskMatrixLevel, string> = {
  LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', VERY_HIGH: 'Very High', CRITICAL: 'Critical',
};
const PROBABILITY_LABELS: Record<number, string> = {
  1: '1 - Rare', 2: '2 - Unlikely', 3: '3 - Possible', 4: '4 - Likely', 5: '5 - Almost Certain',
};
const IMPACT_LABELS: Record<number, string> = {
  1: '1 - Negligible', 2: '2 - Minor', 3: '3 - Moderate', 4: '4 - Major', 5: '5 - Severe',
};

function tooltipStyle(colors: ThemeColors) {
  return { background: colors['base-800'], border: `1px solid ${colors['base-700']}`, borderRadius: 4, fontSize: 12, color: colors['ink-100'] };
}

function timeAgo(iso?: string): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function LevelBadge({ level }: { level: RiskLevel }) {
  const color = levelColors(useThemeColors())[level];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide"
      style={{ color, backgroundColor: `${color}22` }}
    >
      {LEVEL_LABELS[level]}
    </span>
  );
}

function TrendIndicator({ trend }: { trend: Risk['trend'] }) {
  if (trend === 'INCREASING') return <span className="text-danger text-xs">↑ Increasing</span>;
  if (trend === 'DECREASING') return <span className="text-ok text-xs">↓ Decreasing</span>;
  if (trend === 'NEW') return <span className="text-ink-500 text-xs">● New</span>;
  return <span className="text-ink-500 text-xs">→ Stable</span>;
}

export function RiskIntelligenceSection({ projectId }: { projectId: string }) {
  const themeColors = useThemeColors();
  const LEVEL_COLORS = levelColors(themeColors);
  const MATRIX_LEVEL_COLORS = matrixLevelColors(themeColors);
  const queryClient = useQueryClient();
  const [detailRiskId, setDetailRiskId] = useState<string | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphFocusNodeId, setGraphFocusNodeId] = useState<string | undefined>(undefined);
  const [filters, setFilters] = useState<RegisterFilters>(DEFAULT_REGISTER_FILTERS);
  const [movementDays, setMovementDays] = useState<7 | 14 | 30>(7);
  const registerRef = useRef<HTMLDivElement>(null);

  const invalidateAll = () => {
    ['risk-summary', 'risk-top', 'risk-emerging', 'risk-by-discipline', 'risk-clusters', 'risk-data-availability', 'risk-register', 'risk-discrepancies', 'risk-heatmap', 'risk-movement']
      .forEach((key) => queryClient.invalidateQueries({ queryKey: [key, projectId] }));
  };

  const summaryQuery = useQuery({ queryKey: ['risk-summary', projectId], queryFn: () => getRiskSummary(projectId) });
  const topQuery = useQuery({ queryKey: ['risk-top', projectId], queryFn: () => getTopRisks(projectId, 5) });
  const emergingQuery = useQuery({ queryKey: ['risk-emerging', projectId], queryFn: () => getEmergingRisks(projectId, 5) });
  const byDisciplineQuery = useQuery({ queryKey: ['risk-by-discipline', projectId], queryFn: () => getRiskByDiscipline(projectId) });
  const clustersQuery = useQuery({ queryKey: ['risk-clusters', projectId], queryFn: () => getRiskClusters(projectId) });
  const dataAvailabilityQuery = useQuery({ queryKey: ['risk-data-availability', projectId], queryFn: () => getRiskDataAvailability(projectId) });
  const registerQuery = useQuery({ queryKey: ['risk-register', projectId], queryFn: () => listRisks(projectId) });
  const discrepanciesQuery = useQuery({ queryKey: ['risk-discrepancies', projectId], queryFn: () => getMatrixDiscrepancies(projectId) });
  const heatmapQuery = useQuery({ queryKey: ['risk-heatmap', projectId], queryFn: () => getRiskHeatmap(projectId) });
  const movementQuery = useQuery({ queryKey: ['risk-movement', projectId, movementDays], queryFn: () => getRiskMovement(projectId, movementDays) });
  const membersQuery = useQuery({ queryKey: ['members', projectId], queryFn: () => getMembers(projectId) });

  const recalcMutation = useMutation({
    mutationFn: () => recalculateRisk(projectId),
    onSuccess: invalidateAll,
  });

  const aiBriefingMutation = useMutation({ mutationFn: () => getAiBriefing(projectId) });

  const projectQuery = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) });

  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  async function handleDownloadPdf() {
    setPdfError('');
    setPdfDownloading(true);
    try {
      // If the user already generated an AI briefing on this page, it's
      // passed through verbatim -- the PDF never triggers its own AI call
      // and can never show a different narrative than what's on screen.
      const briefingText = aiBriefingMutation.data && 'narrative' in aiBriefingMutation.data
        ? aiBriefingMutation.data.narrative
        : undefined;
      const date = new Date().toISOString().slice(0, 10);
      const filename = `${projectQuery.data?.code ?? projectId}-risk-report-${date}.pdf`;
      await downloadRiskPdf(projectId, filename, briefingText);
    } catch (err) {
      setPdfError(apiErrorMessage(err));
    } finally {
      setPdfDownloading(false);
    }
  }

  const summary = summaryQuery.data;
  const availability = dataAvailabilityQuery.data;
  const hasAnyData = availability && (availability.rfisAvailable + availability.issuesAvailable + availability.snagItemsAvailable + availability.qaInspectionsAvailable) > 0;

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const ownerNames = useMemo(() => ownerNameMap(members), [members]);

  const allRisks = useMemo(() => registerQuery.data ?? [], [registerQuery.data]);
  const openRisks = useMemo(() => allRisks.filter((r) => isOpenRiskStatus(r.status)), [allRisks]);
  const unassignedCount = useMemo(() => openRisks.filter((r) => !r.ownerId).length, [openRisks]);
  const mitigatedCount = useMemo(() => allRisks.filter((r) => r.status === 'RESOLVED' || r.status === 'CLOSED').length, [allRisks]);
  const mitigationRatePct = allRisks.length > 0 ? Math.round((mitigatedCount / allRisks.length) * 100) : null;

  const lastUpdated = allRisks.reduce<string | undefined>((latest, r) => (
    !latest || new Date(r.lastCalculatedAt) > new Date(latest) ? r.lastCalculatedAt : latest
  ), undefined);

  function openRisk(riskId: string) {
    setDetailRiskId(riskId);
  }

  function applyFiltersAndScroll(next: RegisterFilters) {
    setFilters(next);
    requestAnimationFrame(() => registerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3 pb-1 border-b border-base-700/60">
        <div className="flex items-center gap-3 flex-wrap">
          {summary && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-semibold tabular-nums" style={{ color: LEVEL_COLORS[summary.overallLevel] }}>{summary.overallScore}</span>
              <span className="text-xs text-ink-500">/100 overall</span>
              {summary.overallScoreTrendPct !== null && (
                <span className={`text-xs ${summary.overallScoreTrendPct > 0 ? 'text-danger' : 'text-ok'}`}>
                  {summary.overallScoreTrendPct > 0 ? '↑' : '↓'} {Math.abs(summary.overallScoreTrendPct)}%
                </span>
              )}
            </div>
          )}
          <span className="text-xs text-ink-500">Last updated {timeAgo(lastUpdated)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setGraphOpen(true)} className="btn-secondary !px-3 !py-1.5 text-xs">
            View Risk Graph
          </button>
          <button onClick={handleDownloadPdf} disabled={pdfDownloading || !hasAnyData} className="btn-secondary !px-3 !py-1.5 text-xs">
            {pdfDownloading ? 'Preparing…' : 'Export Report'}
          </button>
          <button onClick={() => recalcMutation.mutate()} disabled={recalcMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
            {recalcMutation.isPending ? 'Analyzing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {recalcMutation.isError && <p className="field-error">{apiErrorMessage(recalcMutation.error)}</p>}
      {pdfError && <p className="field-error">{pdfError}</p>}

      {!hasAnyData && !dataAvailabilityQuery.isLoading && (
        <div className="panel tick-frame p-8 text-center space-y-2">
          <p className="text-sm text-ink-300">Risk intelligence is building.</p>
          <p className="text-xs text-ink-500">
            No RFIs, Issues, Snag items, or QA inspections were found yet on this project — connect project data to begin generating risk intelligence.
          </p>
        </div>
      )}

      {availability && hasAnyData && (
        <div className="panel p-3 text-xs text-ink-500 flex flex-wrap gap-x-6 gap-y-1">
          <span>RFIs available: <span className="text-ink-300">{availability.rfisAvailable}</span></span>
          <span>Issues available: <span className="text-ink-300">{availability.issuesAvailable}</span></span>
          <span>Snag items available: <span className="text-ink-300">{availability.snagItemsAvailable}</span></span>
          <span>QA inspections available: <span className="text-ink-300">{availability.qaInspectionsAvailable}</span></span>
          <span>BIM relationships: <span className="text-ink-300">{availability.bimElementRelationships}</span></span>
          <span>Programme data: <span className="text-ink-300">{availability.programmeData}</span></span>
          <span>Procurement data: <span className="text-ink-300">{availability.procurementData}</span></span>
        </div>
      )}

      {summary && hasAnyData && (
        <>
          {/* Minto Pyramid: the conclusion comes first -- before the KPI
              strip and attention panel below, not after. A reader should
              get the principal message and its reasons before being shown
              the numbers that support it, not the reverse. */}
          {/* Risk Summary — deterministic, grounded in the summary above; never a free-floating claim */}
          {(summary.totalOpenRisks > 0 || (discrepanciesQuery.data?.length ?? 0) > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-4">
                {summary.totalOpenRisks > 0 && (
                  <div className="panel p-4">
                    <div className="!mb-2"><SectionHeader title="Risk Summary" size="sm" /></div>
                    <p className="text-sm text-ink-300 leading-relaxed">
                      {buildBriefing(summary, topQuery.data ?? [], clustersQuery.data ?? [])}
                    </p>
                  </div>
                )}

                {(discrepanciesQuery.data?.length ?? 0) > 0 && (
                  <div className="panel tick-frame p-4 border border-warn/40 bg-warn/5 space-y-2">
                    <div className="field-label !mb-1">
                      Alerts — {discrepanciesQuery.data!.length} risk{discrepanciesQuery.data!.length === 1 ? '' : 's'} need{discrepanciesQuery.data!.length === 1 ? 's' : ''} discrepancy review
                    </div>
                    <div className="divide-y divide-base-700/60">
                      {(discrepanciesQuery.data ?? []).map(({ risk: r, discrepancy }) => (
                        <button key={r.id} onClick={() => openRisk(r.id)} className="w-full flex items-center justify-between gap-4 py-2 text-left hover:bg-base-700 transition-colors">
                          <span className="text-sm text-ink-100">{r.title}</span>
                          <span className="text-xs text-ink-500 shrink-0">
                            Human <span className="font-semibold" style={{ color: MATRIX_LEVEL_COLORS[r.humanLevel!] }}>{MATRIX_LEVEL_LABELS[r.humanLevel!]}</span>
                            {' '}vs AI <span className="font-semibold" style={{ color: MATRIX_LEVEL_COLORS[r.aiLevel!] }}>{MATRIX_LEVEL_LABELS[r.aiLevel!]}</span>
                            {' '}({discrepancy.levelGap} apart)
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* AI Project Risk Briefing — an LLM-polished narrative generated
                  on demand from the exact same computed data above, never from
                  a fresh retrieval. Clearly labeled as AI-generated and never
                  auto-fetched, since it's a real model call with real latency. */}
              {summary.totalOpenRisks > 0 && (
                <div className="panel p-4">
                  <div className="!mb-2">
                    <SectionHeader
                      title="AI Project Risk Briefing"
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
                  {aiBriefingMutation.data && 'narrative' in aiBriefingMutation.data && (
                    <p className="text-sm text-ink-300 leading-relaxed">{aiBriefingMutation.data.narrative}</p>
                  )}
                  {!aiBriefingMutation.data && !aiBriefingMutation.isPending && (
                    <p className="text-xs text-ink-500">Generate an AI-polished narrative of the risk summary above.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <RiskKpiStrip
            summary={summary}
            totalActive={openRisks.length}
            unassignedCount={unassignedCount}
            mitigationRatePct={mitigationRatePct}
            onFilterTotalActive={() => applyFiltersAndScroll({ ...DEFAULT_REGISTER_FILTERS, activeOnly: true })}
            onFilterCriticalHigh={() => applyFiltersAndScroll({ ...DEFAULT_REGISTER_FILTERS, levels: ['CRITICAL', 'HIGH'] })}
            onFilterOverdue={() => applyFiltersAndScroll({ ...DEFAULT_REGISTER_FILTERS, overdueOnly: true })}
            onFilterUnassigned={() => applyFiltersAndScroll({ ...DEFAULT_REGISTER_FILTERS, owner: 'UNASSIGNED' })}
            onFilterMitigated={() => applyFiltersAndScroll({ ...DEFAULT_REGISTER_FILTERS, statuses: ['RESOLVED', 'CLOSED'] })}
          />

          <RiskAttentionPanel risks={openRisks} ownerNames={ownerNames} onSelectRisk={openRisk} />

          {/* Risk Movement (brief Phase 3): emerged/worsened/improved/
              unresolved during a selectable window, from real snapshot
              history -- placed right after the critical-risk views above
              and before the heatmap/register below, per the brief's own
              prescribed order. */}
          <RiskMovementSection
            movement={movementQuery.data}
            isLoading={movementQuery.isLoading}
            days={movementDays}
            onDaysChange={setMovementDays}
            onSelectRisk={openRisk}
          />

          {/* Risk analytics -- heatmap + discipline chart side by side on
              desktop, stacked on mobile, consistent card heights. */}
          {((heatmapQuery.data?.some((c) => c.count > 0)) || (byDisciplineQuery.data?.length ?? 0) > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
              {heatmapQuery.data?.some((c) => c.count > 0) && (
                <RiskHeatmap
                  cells={heatmapQuery.data!}
                  risks={allRisks}
                  onSelectRisk={openRisk}
                  onFilterCell={(riskIds, label) => applyFiltersAndScroll({ ...DEFAULT_REGISTER_FILTERS, cellRiskIds: riskIds, cellLabel: label })}
                />
              )}
              {(byDisciplineQuery.data?.length ?? 0) > 0 && (
                <RiskDisciplineChart
                  data={byDisciplineQuery.data!}
                  onSelectDiscipline={(d) => applyFiltersAndScroll({ ...DEFAULT_REGISTER_FILTERS, discipline: d, activeOnly: true })}
                />
              )}
            </div>
          )}

          {/* Top Management Risks */}
          {(topQuery.data?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <SectionHeader title="Top Management Risks" size="sm" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {(topQuery.data ?? []).map((r) => (
                  <button key={r.id} onClick={() => openRisk(r.id)} className="panel tick-frame p-4 text-left hover:bg-base-700 transition-colors space-y-2">
                    <div className="flex items-center justify-between">
                      <LevelBadge level={r.level} />
                      <span className="text-lg font-semibold tabular-nums text-ink-100">{r.score}</span>
                    </div>
                    <div className="text-sm text-ink-100 font-medium">{r.title}</div>
                    <TrendIndicator trend={r.trend} />
                    {r.recommendedAction && (
                      <p className="text-xs text-ink-500">Recommended: {r.recommendedAction}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Emerging Risks */}
          {(emergingQuery.data?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <SectionHeader title="Emerging Risks" size="sm" />
              <div className="panel tick-frame divide-y divide-base-700/60">
                {(emergingQuery.data ?? []).map((r) => (
                  <button key={r.id} onClick={() => openRisk(r.id)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-base-700 transition-colors">
                    <div>
                      <div className="text-sm text-ink-100">{r.title}</div>
                      <div className="text-xs text-ink-500 mt-0.5">{r.explanation}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <span className="text-sm tabular-nums text-ink-300">{r.score}</span>
                      <TrendIndicator trend={r.trend} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Risk Clusters */}
          {(clustersQuery.data?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <SectionHeader title="Risk Concentration by Location" size="sm" />
              <div className="panel tick-frame divide-y divide-base-700/60">
                {(clustersQuery.data ?? []).map((c) => (
                  <div key={c.location} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-ink-100">{c.location}</span>
                    <span className="text-ink-500">{c.connectedRiskCount} connected risk(s) · avg score {c.averageScore}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Risk Register -- the primary working area (brief section 4E) */}
          <div ref={registerRef}>
            <RiskRegisterTable
              risks={allRisks}
              members={members}
              ownerNames={ownerNames}
              filters={filters}
              onFiltersChange={setFilters}
              onSelectRisk={openRisk}
            />
          </div>
        </>
      )}

      {detailRiskId && (
        <RiskDetailDrawer
          projectId={projectId}
          riskId={detailRiskId}
          members={members}
          onClose={() => setDetailRiskId(null)}
          onChanged={invalidateAll}
          onViewGraph={(rootNodeId) => { setGraphFocusNodeId(rootNodeId); setGraphOpen(true); setDetailRiskId(null); }}
        />
      )}

      {graphOpen && (
        <RiskGraphView projectId={projectId} initialRootNodeId={graphFocusNodeId} onClose={() => { setGraphOpen(false); setGraphFocusNodeId(undefined); }} />
      )}
    </section>
  );
}

function buildBriefing(summary: ReturnType<typeof getRiskSummary> extends Promise<infer T> ? T : never, topRisks: Risk[], clusters: { location: string; connectedRiskCount: number }[]): string {
  const parts: string[] = [];
  parts.push(`Overall project risk is currently ${summary.overallScore}/100 (${LEVEL_LABELS[summary.overallLevel].toLowerCase()}).`);
  if (summary.overallScoreTrendPct !== null) {
    parts.push(`This is ${summary.overallScoreTrendPct > 0 ? 'up' : 'down'} ${Math.abs(summary.overallScoreTrendPct)}% over the last 7 days.`);
  }
  if (summary.criticalCount > 0) {
    parts.push(`${summary.criticalCount} critical risk${summary.criticalCount === 1 ? '' : 's'} require${summary.criticalCount === 1 ? 's' : ''} management attention.`);
  }
  if (topRisks[0]) {
    parts.push(`The highest-scoring risk is "${topRisks[0].title}" (${topRisks[0].score}/100).`);
  }
  if (clusters[0]) {
    parts.push(`The highest concentration of connected risk is currently at ${clusters[0].location} (${clusters[0].connectedRiskCount} connected items).`);
  }
  if (summary.overdueCount > 0) {
    parts.push(`${summary.overdueCount} risk-linked item${summary.overdueCount === 1 ? ' is' : 's are'} already overdue.`);
  }
  return parts.join(' ');
}

function RiskDetailDrawer({ projectId, riskId, members, onClose, onChanged, onViewGraph }: {
  projectId: string; riskId: string; members: ProjectMember[];
  onClose: () => void; onChanged: () => void; onViewGraph: (rootNodeId: string) => void;
}) {
  const themeColors = useThemeColors();
  const LEVEL_COLORS = levelColors(themeColors);
  const TOOLTIP_STYLE = tooltipStyle(themeColors);
  const queryClient = useQueryClient();
  const riskQuery = useQuery({ queryKey: ['risk-detail', projectId, riskId], queryFn: () => getRisk(projectId, riskId) });
  const chainQuery = useQuery({ queryKey: ['risk-chain', riskId], queryFn: () => getRiskChain(projectId, riskId) });
  const evidenceQuery = useQuery({ queryKey: ['risk-evidence', riskId], queryFn: () => getRiskEvidence(projectId, riskId) });
  const historyQuery = useQuery({ queryKey: ['risk-history', riskId], queryFn: () => getRiskHistory(projectId, riskId) });

  const [overrideScore, setOverrideScore] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [dueDateInput, setDueDateInput] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['risk-detail', projectId, riskId] });
    onChanged();
  };

  const overrideMutation = useMutation({
    mutationFn: () => overrideRisk(projectId, riskId, { score: overrideScore ? Number(overrideScore) : undefined, reason: overrideReason }),
    onSuccess: () => { invalidate(); setOverrideScore(''); setOverrideReason(''); },
  });
  const clearOverrideMutation = useMutation({ mutationFn: () => clearRiskOverride(projectId, riskId), onSuccess: invalidate });
  const statusMutation = useMutation({ mutationFn: (status: RiskStatus) => setRiskStatus(projectId, riskId, status), onSuccess: invalidate });
  const aiExplanationMutation = useMutation({ mutationFn: () => getAiExplanation(projectId, riskId) });
  const ownerMutation = useMutation({ mutationFn: (ownerId: string | null) => assignRiskOwner(projectId, riskId, ownerId), onSuccess: invalidate });
  const dueDateMutation = useMutation({ mutationFn: (dueDate: string | null) => setRiskDueDate(projectId, riskId, dueDate), onSuccess: invalidate });

  const risk = riskQuery.data;
  const tone = risk ? dueDateTone(risk) : 'none';

  return (
    <Modal open onClose={onClose} title={risk?.title ?? 'Risk detail'} wide>
      {!risk ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <div className="text-3xl font-semibold tabular-nums" style={{ color: LEVEL_COLORS[risk.level] }}>{risk.score}</div>
              <div className="text-xs text-ink-500">out of 100</div>
            </div>
            <LevelBadge level={risk.level} />
            <TrendIndicator trend={risk.trend} />
            <span className="text-xs text-ink-500">Confidence: {risk.confidenceLevel}</span>
            {risk.overrideScore !== undefined && risk.overrideScore !== null && (
              <span className="text-xs text-warn">User override active (automated: {risk.automatedScore})</span>
            )}
          </div>

          {risk.confidenceReason && (
            <p className="text-xs text-ink-500">Data-driven project risk assessment. Confidence reason: {risk.confidenceReason}</p>
          )}

          {/* Owner & due date -- the two fields the KPI strip, Attention
              panel and Register all read; editable right here so assigning
              an owner or a deadline doesn't require a separate screen. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="panel p-3">
              <div className="field-label !mb-1.5">Owner</div>
              <Listbox
                value={risk.ownerId ?? ''}
                onChange={(e) => ownerMutation.mutate(e.target.value || null)}
                disabled={ownerMutation.isPending}
                className="field-input !py-1.5 text-xs"
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
                ))}
              </Listbox>
            </div>
            <div className="panel p-3">
              <div className="flex items-center justify-between !mb-1.5">
                <div className="field-label !mb-0">Due date</div>
                {tone === 'overdue' && <span className="text-[10px] font-semibold uppercase text-danger">Overdue</span>}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dueDateInput || (risk.dueDate ? risk.dueDate.slice(0, 10) : '')}
                  onChange={(e) => setDueDateInput(e.target.value)}
                  className="field-input !py-1.5 text-xs flex-1"
                />
                <button
                  onClick={() => dueDateMutation.mutate(dueDateInput ? new Date(dueDateInput).toISOString() : null)}
                  disabled={dueDateMutation.isPending}
                  className="btn-secondary !px-2 !py-1.5 text-xs shrink-0"
                >
                  Save
                </button>
                {risk.dueDate && (
                  <button onClick={() => { setDueDateInput(''); dueDateMutation.mutate(null); }} disabled={dueDateMutation.isPending} className="btn-ghost !px-2 !py-1.5 text-xs shrink-0">
                    Clear
                  </button>
                )}
              </div>
              {risk.dueDate && <p className="text-xs text-ink-500 mt-1.5">Currently {formatDueDate(risk.dueDate)}</p>}
            </div>
          </div>

          {risk.explanation && (
            <div>
              <div className="field-label !mb-1">Why is this a risk?</div>
              <p className="text-sm text-ink-300">{risk.explanation}</p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between !mb-1">
              <div className="field-label !mb-0">AI explanation</div>
              <button onClick={() => aiExplanationMutation.mutate()} disabled={aiExplanationMutation.isPending} className="btn-secondary !px-2.5 !py-1 text-xs">
                {aiExplanationMutation.isPending ? 'Generating…' : aiExplanationMutation.data ? 'Regenerate' : 'Generate'}
              </button>
            </div>
            {aiExplanationMutation.isError && <p className="field-error">{apiErrorMessage(aiExplanationMutation.error)}</p>}
            {aiExplanationMutation.data && 'unavailable' in aiExplanationMutation.data && (
              <p className="text-sm text-ink-500 italic">{aiExplanationMutation.data.reason}</p>
            )}
            {aiExplanationMutation.data && 'narrative' in aiExplanationMutation.data && (
              <p className="text-sm text-ink-300">{aiExplanationMutation.data.narrative}</p>
            )}
            {!aiExplanationMutation.data && !aiExplanationMutation.isPending && (
              <p className="text-xs text-ink-500">Generate an AI-polished explanation, grounded in the same factors and evidence shown here.</p>
            )}
          </div>

          <div>
            <div className="field-label !mb-2">Risk factors</div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {(['probability', 'impact', 'exposure', 'dependency', 'urgency', 'recurrence'] as const).map((factor) => (
                <div key={factor} className="panel p-2 text-center">
                  <div className="text-[11px] text-ink-500 font-medium">{factor}</div>
                  <div className="text-sm font-semibold text-ink-100 tabular-nums">{risk[factor]}</div>
                </div>
              ))}
            </div>
          </div>

          {risk.recommendedAction && (
            <div>
              <div className="field-label !mb-1">Recommended action</div>
              <p className="text-sm text-ink-300">{risk.recommendedAction}</p>
            </div>
          )}

          <HumanAssessmentPanel projectId={projectId} risk={risk} onChanged={invalidate} />

          <button onClick={() => onViewGraph(risk.rootNodeId)} className="btn-secondary !px-2.5 !py-1 text-xs">
            View in Risk Graph
          </button>

          {(chainQuery.data?.steps.length ?? 0) > 1 && (
            <div>
              <div className="field-label !mb-2">Risk chain</div>
              <div className="space-y-1">
                {(chainQuery.data?.steps ?? []).map((step, i) => (
                  <div key={step.nodeId} className="flex items-center gap-2 text-sm">
                    {i > 0 && <span className="text-ink-500">↓ {step.relationshipFromPrevious}{step.confidence !== null && step.confidence < 1 ? ` (inferred, ${Math.round((step.confidence ?? 0) * 100)}%)` : ''}</span>}
                    {i === 0 && <span className="text-ink-500 w-4" />}
                    <span className="text-ink-100">{step.label} <span className="text-ink-500 text-xs">({step.nodeType})</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(evidenceQuery.data?.length ?? 0) > 0 && (
            <div>
              <div className="field-label !mb-2">Evidence</div>
              <ul className="space-y-1">
                {(evidenceQuery.data ?? []).map((e) => (
                  <li key={e.id} className="text-sm">
                    <EvidenceLink projectId={projectId} node={e.node} role={e.role} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="field-label !mb-2">Status</div>
            <div className="flex items-center gap-2 flex-wrap">
              {(Object.keys(STATUS_LABELS) as RiskStatus[]).map((s) => (
                <button
                  key={s} onClick={() => statusMutation.mutate(s)} disabled={statusMutation.isPending}
                  className={`btn-secondary !px-2.5 !py-1 text-xs ${risk.status === s ? '!bg-blueprint/20 !text-blueprint' : ''}`}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="field-label !mb-2">Override</div>
            {risk.overrideScore !== undefined && risk.overrideScore !== null ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-500">Override reason: {risk.overrideReason}</span>
                <button onClick={() => clearOverrideMutation.mutate()} className="btn-secondary !px-2.5 !py-1 text-xs">Clear override</button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <input type="number" min={0} max={100} placeholder="Score" value={overrideScore} onChange={(e) => setOverrideScore(e.target.value)} className="field-input w-24 !py-1 text-xs" />
                <input type="text" placeholder="Reason (required)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} className="field-input flex-1 !py-1 text-xs" />
                <button
                  onClick={() => overrideMutation.mutate()}
                  disabled={overrideMutation.isPending || overrideReason.length < 3}
                  className="btn-secondary !px-2.5 !py-1 text-xs"
                >
                  Apply override
                </button>
              </div>
            )}
          </div>

          {(historyQuery.data?.length ?? 0) > 1 && (
            <div>
              <div className="field-label !mb-2">History</div>
              <div style={{ width: '100%', height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={historyQuery.data}>
                    <XAxis dataKey="snapshotAt" tick={{ fill: themeColors['ink-500'], fontSize: 9 }} tickFormatter={(v) => new Date(v).toLocaleDateString()} />
                    <YAxis tick={{ fill: themeColors['ink-500'], fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="score" fill={themeColors.blueprint} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// Progressive-disclosure Human Risk Assessment: Probability x Impact (brief
// sections 3-6, 42-43). A separate component (not inline in its callers)
// purely so its form state initializes from `risk`'s already-loaded values
// via plain useState lazy init -- no useEffect sync needed, since the
// RiskDetailDrawer usage never mounts this before `risk` exists (see its
// own !risk guard). `risk` is nullable here specifically for the inline
// Issue/RFI/Snag widget (InlineRiskAssessment below): an item the automated
// engine hasn't flagged yet has no Risk row at all, but a human must still
// be able to record an assessment -- nodeType/entityId are required in
// that case so the mutation can bootstrap one (setHumanAssessmentByEntity).
export function HumanAssessmentPanel({ projectId, risk, nodeType, entityId, onChanged }: {
  projectId: string;
  risk: (Risk & { discrepancy: RiskMatrixDiscrepancy | null }) | null;
  nodeType?: string; entityId?: string;
  onChanged: () => void;
}) {
  const MATRIX_LEVEL_COLORS = matrixLevelColors(useThemeColors());
  const [probability, setProbability] = useState(String(risk?.humanProbability ?? ''));
  const [impact, setImpact] = useState(String(risk?.humanImpact ?? ''));
  const [primaryDriver, setPrimaryDriver] = useState<RiskDriver | ''>(risk?.primaryDriver ?? '');
  const [secondaryDriver, setSecondaryDriver] = useState<RiskDriver | ''>(risk?.secondaryDriver ?? '');
  const [expanded, setExpanded] = useState(risk?.humanScore == null);

  const mutation = useMutation({
    mutationFn: () => {
      const input = {
        probability: Number(probability), impact: Number(impact),
        primaryDriver: primaryDriver as RiskDriver, secondaryDriver: secondaryDriver || null,
      };
      return risk
        ? setHumanAssessment(projectId, risk.id, input)
        : setHumanAssessmentByEntity(projectId, nodeType!, entityId!, input);
    },
    onSuccess: () => { onChanged(); setExpanded(false); },
  });

  const acceptAiMutation = useMutation({
    mutationFn: () => setMatrixOverride(projectId, risk!.id, { decision: 'ACCEPT_AI' }),
    onSuccess: onChanged,
  });
  const keepHumanMutation = useMutation({
    mutationFn: () => setMatrixOverride(projectId, risk!.id, { decision: 'KEEP_HUMAN' }),
    onSuccess: onChanged,
  });

  const showDiscrepancyBanner = Boolean(risk?.discrepancy?.hasDiscrepancy && !risk.discrepancy.reviewed);

  // Client-side preview only, purely for immediate feedback while picking
  // values -- the actually-persisted score/level always comes back from
  // the server response (see risk.humanScore/humanLevel above), never
  // computed here and trusted as the real answer.
  const previewScore = probability && impact ? Number(probability) * Number(impact) : null;
  const canSave = Boolean(probability && impact && primaryDriver);

  return (
    <div>
      <div className="flex items-center justify-between !mb-2">
        <div className="field-label !mb-0">Human Risk Assessment (Probability × Impact)</div>
        {risk?.humanScore != null && (
          <button onClick={() => setExpanded((v) => !v)} className="text-xs text-blueprint hover:underline">
            {expanded ? 'Collapse' : 'Edit'}
          </button>
        )}
      </div>

      {showDiscrepancyBanner && risk && (
        <div className="panel p-3 mb-2 border border-warn/40 bg-warn/5 space-y-2">
          <p className="text-xs text-ink-100">
            <span className="font-semibold">Human and AI disagree:</span> human assessment is{' '}
            <span className="font-semibold" style={{ color: MATRIX_LEVEL_COLORS[risk.humanLevel!] }}>{MATRIX_LEVEL_LABELS[risk.humanLevel!]}</span>, AI score is{' '}
            <span className="font-semibold" style={{ color: MATRIX_LEVEL_COLORS[risk.aiLevel!] }}>{MATRIX_LEVEL_LABELS[risk.aiLevel!]}</span>
            {' '}({risk.discrepancy!.levelGap} level{risk.discrepancy!.levelGap === 1 ? '' : 's'} apart).
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => keepHumanMutation.mutate()} disabled={keepHumanMutation.isPending} className="btn-secondary !px-2.5 !py-1 text-xs">
              Keep Human Assessment
            </button>
            <button onClick={() => acceptAiMutation.mutate()} disabled={acceptAiMutation.isPending} className="btn-secondary !px-2.5 !py-1 text-xs">
              Accept AI Assessment
            </button>
            <button onClick={() => setExpanded(true)} className="btn-secondary !px-2.5 !py-1 text-xs">
              Update Assessment
            </button>
          </div>
          {(acceptAiMutation.isError || keepHumanMutation.isError) && (
            <p className="field-error">{apiErrorMessage(acceptAiMutation.error ?? keepHumanMutation.error)}</p>
          )}
        </div>
      )}

      {risk?.matrixOverrideBy && risk.discrepancy?.hasDiscrepancy && (
        <p className="text-xs text-ink-500 mb-2">Discrepancy reviewed: {risk.matrixOverrideReason}</p>
      )}

      {risk?.humanScore != null && !expanded ? (
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <span className="text-2xl font-semibold tabular-nums" style={{ color: MATRIX_LEVEL_COLORS[risk.humanLevel!] }}>{risk.humanScore}</span>
          <span className="text-xs text-ink-500">/ 25</span>
          <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase" style={{ color: MATRIX_LEVEL_COLORS[risk.humanLevel!], backgroundColor: `${MATRIX_LEVEL_COLORS[risk.humanLevel!]}22` }}>
            {MATRIX_LEVEL_LABELS[risk.humanLevel!]}
          </span>
          {risk.primaryDriver && <span className="text-xs text-ink-500">Driver: {RISK_DRIVER_LABELS[risk.primaryDriver]}{risk.secondaryDriver ? ` / ${RISK_DRIVER_LABELS[risk.secondaryDriver]}` : ''}</span>}
        </div>
      ) : (
        <div className="panel p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Listbox value={probability} onChange={(e) => setProbability(e.target.value)} className="field-input !py-1 text-xs">
              <option value="">Probability…</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{PROBABILITY_LABELS[n]}</option>)}
            </Listbox>
            <Listbox value={impact} onChange={(e) => setImpact(e.target.value)} className="field-input !py-1 text-xs">
              <option value="">Impact…</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{IMPACT_LABELS[n]}</option>)}
            </Listbox>
            <Listbox value={primaryDriver} onChange={(e) => setPrimaryDriver(e.target.value as RiskDriver)} className="field-input !py-1 text-xs">
              <option value="">Primary driver…</option>
              {RISK_DRIVERS.map((d) => <option key={d} value={d}>{RISK_DRIVER_LABELS[d]}</option>)}
            </Listbox>
            <Listbox value={secondaryDriver} onChange={(e) => setSecondaryDriver(e.target.value as RiskDriver)} className="field-input !py-1 text-xs">
              <option value="">Secondary driver (optional)…</option>
              {RISK_DRIVERS.map((d) => <option key={d} value={d}>{RISK_DRIVER_LABELS[d]}</option>)}
            </Listbox>
          </div>
          <div className="flex items-center gap-3">
            {previewScore !== null ? (
              <span className="text-sm text-ink-300">
                Risk Score <span className="font-semibold tabular-nums">{previewScore}</span> / 25
              </span>
            ) : (
              <span className="text-xs text-ink-500">Select probability and impact to see the score.</span>
            )}
            <button onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending} className="btn-primary !px-2.5 !py-1 text-xs ml-auto">
              {mutation.isPending ? 'Saving…' : 'Save assessment'}
            </button>
          </div>
          {mutation.isError && <p className="field-error">{apiErrorMessage(mutation.error)}</p>}
        </div>
      )}

      {risk?.aiScore != null ? (
        <p className="text-xs text-ink-500 mt-2">
          AI score: <span className="font-semibold">{risk.aiScore}/25</span> ({risk.aiLevel ? MATRIX_LEVEL_LABELS[risk.aiLevel] : '—'})
          {risk.aiConfidence != null && ` · Confidence: ${risk.aiConfidence}%`}
        </p>
      ) : !risk && (
        <p className="text-xs text-ink-500 mt-2">No automated risk signals detected for this item yet — your assessment will still be recorded.</p>
      )}
    </div>
  );
}

/**
 * Wires HumanAssessmentPanel into an Issue/RFI/Snag detail view (brief
 * sections 42-43): looks up the Risk for this entity (if any exists yet)
 * and lets the panel itself handle both the "already has a Risk" case and
 * the "nothing detected yet, bootstrap on save" case.
 */
export function InlineRiskAssessment({ projectId, nodeType, entityId }: { projectId: string; nodeType: 'issue' | 'rfi' | 'snag_item' | 'submittal' | 'ncr'; entityId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['risk-by-entity', projectId, nodeType, entityId];
  const riskQuery = useQuery({ queryKey, queryFn: () => getRiskByEntity(projectId, nodeType, entityId) });

  if (riskQuery.isLoading) return null;

  return (
    <HumanAssessmentPanel
      projectId={projectId}
      risk={riskQuery.data ?? null}
      nodeType={nodeType}
      entityId={entityId}
      onChanged={() => queryClient.invalidateQueries({ queryKey })}
    />
  );
}

const EVIDENCE_LINK_ROUTE: Record<string, (projectId: string) => string> = {
  rfi: (pid) => `/projects/${pid}/rfis`,
  issue: (pid) => `/projects/${pid}/issues`,
  snag_item: (pid) => `/projects/${pid}/snagging`,
  qa_inspection: (pid) => `/projects/${pid}/reports`,
  drawing: (pid) => `/projects/${pid}/drawings`,
  bim_element: (pid) => `/projects/${pid}/bim`,
  submittal: (pid) => `/projects/${pid}/submittals`,
  ncr: (pid) => `/projects/${pid}/qaqc/ncr`,
};

function EvidenceLink({ projectId, node, role }: { projectId: string; node?: { nodeType: string; label: string }; role: string }) {
  if (!node) return null;
  const route = EVIDENCE_LINK_ROUTE[node.nodeType];
  const roleLabel = role.replace(/_/g, ' ').toLowerCase();
  if (!route) {
    return <span className="text-ink-300">{node.label} <span className="text-ink-500 text-xs">({roleLabel})</span></span>;
  }
  return (
    <Link to={route(projectId)} className="text-blueprint hover:underline">
      {node.label} <span className="text-ink-500 text-xs">({roleLabel})</span>
    </Link>
  );
}
