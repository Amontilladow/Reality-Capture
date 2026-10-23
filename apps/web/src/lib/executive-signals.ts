import type { StatusTone } from './status-tone';

// Shared Minto Pyramid primitives for both the per-project Executive
// Command Center (ExecutiveBriefing.tsx) and the cross-project one
// (CompanyExecutiveBriefing.tsx) -- one ranking rule, one conclusion
// sentence builder, used identically at either scope so "critical" means
// the same thing on both screens. Nothing here is a new calculation: every
// number a caller passes in is already computed by an existing, validated
// backend aggregate (risk executive summary, report KPI summaries) -- this
// file only ranks and phrases them.

export type Severity = 'critical' | 'high' | 'medium';

export interface PrioritySignal {
  domain: string;
  label: string;
  explanation: string;
  severity: Severity;
  to: string;
  // Only set by the cross-project builder, to label/link each row back to
  // its project -- undefined on the per-project screen, where it would be
  // redundant (the whole page is already scoped to one project).
  projectId?: string;
  projectName?: string;
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };
export const SEVERITY_TONE: Record<Severity, StatusTone> = { critical: 'critical', high: 'warning', medium: 'progress' };
export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium' };

export type OverallStatus = 'critical' | 'at_risk' | 'stable' | 'no_data';
export const STATUS_LABEL: Record<OverallStatus, string> = {
  critical: 'Needs immediate attention', at_risk: 'At risk', stable: 'Stable', no_data: 'Not enough data yet',
};
export const STATUS_TONE: Record<OverallStatus, StatusTone> = {
  critical: 'critical', at_risk: 'warning', stable: 'success', no_data: 'neutral',
};

// The transparent, documented rule "overall status" is derived from --
// never a hidden formula. CRITICAL whenever any signal is itself
// critical-severity; AT_RISK when nothing is critical but something needs
// attention soon; STABLE only once both of those are empty AND there is
// enough real recorded activity to say so with any confidence.
export function deriveOverallStatus(signals: PrioritySignal[], hasAnyActivity: boolean): OverallStatus {
  if (!hasAnyActivity) return 'no_data';
  if (signals.some((s) => s.severity === 'critical')) return 'critical';
  if (signals.some((s) => s.severity === 'high')) return 'at_risk';
  return 'stable';
}

export function sortBySeverity(signals: PrioritySignal[]): PrioritySignal[] {
  return [...signals].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// Lean per-domain inputs -- just the fields the signal rules below actually
// read, not a full ReportKpis/RiskExecutiveSummary. The per-project
// ExecutiveBriefing.tsx slices those fuller types down to this shape; the
// company-wide endpoint returns exactly this shape already, since nothing
// else is needed at that scale.
export interface SignalInputs {
  risk?: { criticalCount: number; overdueCount: number };
  issues?: { critical: number; overdue: number };
  rfis?: { overdue: number };
  qaqc?: { critical: number; overdue: number };
  snagging?: { overdue: number };
  bimFailedCount?: number;
}

// basePath is the project-scoped route prefix (`/projects/${projectId}`)
// every generated signal's `to` link is built from -- the one thing that
// differs between the per-project and cross-project callers.
export function buildSignals(basePath: string, input: SignalInputs): PrioritySignal[] {
  const signals: PrioritySignal[] = [];

  if (input.risk) {
    const { criticalCount, overdueCount } = input.risk;
    if (criticalCount > 0) {
      signals.push({
        domain: 'Risk', severity: 'critical', to: `${basePath}/risk`,
        label: `${criticalCount} critical risk${criticalCount === 1 ? '' : 's'} open`,
        explanation: `${criticalCount} critical risk${criticalCount === 1 ? '' : 's'} remain open`,
      });
    }
    if (overdueCount > 0) {
      signals.push({
        domain: 'Risk', severity: 'high', to: `${basePath}/risk`,
        label: `${overdueCount} overdue risk action${overdueCount === 1 ? '' : 's'}`,
        explanation: `${overdueCount} risk mitigation action${overdueCount === 1 ? ' is' : 's are'} overdue`,
      });
    }
  }

  if (input.issues) {
    const { critical, overdue } = input.issues;
    if (critical > 0) {
      signals.push({
        domain: 'Issues', severity: 'critical', to: `${basePath}/issues`,
        label: `${critical} critical issue${critical === 1 ? '' : 's'}`,
        explanation: `${critical} critical issue${critical === 1 ? ' is' : 's are'} open`,
      });
    }
    if (overdue > 0) {
      signals.push({
        domain: 'Issues', severity: 'high', to: `${basePath}/issues`,
        label: `${overdue} overdue issue${overdue === 1 ? '' : 's'}`,
        explanation: `${overdue} issue${overdue === 1 ? ' is' : 's are'} overdue`,
      });
    }
  }

  if (input.rfis && input.rfis.overdue > 0) {
    const { overdue } = input.rfis;
    signals.push({
      domain: 'RFIs', severity: 'high', to: `${basePath}/rfis`,
      label: `${overdue} overdue RFI${overdue === 1 ? '' : 's'}`,
      explanation: `${overdue} RFI${overdue === 1 ? ' is' : 's are'} overdue, which can block downstream design information`,
    });
  }

  if (input.qaqc) {
    const { critical, overdue } = input.qaqc;
    if (critical > 0) {
      signals.push({
        domain: 'QAQC', severity: 'critical', to: `${basePath}/qaqc`,
        label: `${critical} critical QA/QC record${critical === 1 ? '' : 's'}`,
        explanation: `${critical} critical QA/QC record${critical === 1 ? ' is' : 's are'} open`,
      });
    }
    if (overdue > 0) {
      signals.push({
        domain: 'QAQC', severity: 'high', to: `${basePath}/qaqc`,
        label: `${overdue} overdue QA/QC record${overdue === 1 ? '' : 's'}`,
        explanation: `${overdue} QA/QC record${overdue === 1 ? ' is' : 's are'} overdue`,
      });
    }
  }

  if (input.snagging && input.snagging.overdue > 0) {
    const { overdue } = input.snagging;
    signals.push({
      domain: 'Snagging', severity: 'medium', to: `${basePath}/snagging`,
      label: `${overdue} overdue snag${overdue === 1 ? '' : 's'}`,
      explanation: `${overdue} snag item${overdue === 1 ? ' is' : 's are'} overdue`,
    });
  }

  if (input.bimFailedCount && input.bimFailedCount > 0) {
    const count = input.bimFailedCount;
    signals.push({
      domain: 'BIM', severity: 'medium', to: `${basePath}/bim`,
      label: `${count} BIM model${count === 1 ? '' : 's'} failed processing`,
      explanation: `${count} BIM model${count === 1 ? ' failed' : 's failed'} to process`,
    });
  }

  return sortBySeverity(signals);
}

export function buildConclusion(status: OverallStatus, signals: PrioritySignal[], scopeLabel: string): string {
  if (status === 'no_data') {
    return `No risks, issues, RFIs, QA records, or snag items have been recorded ${scopeLabel} yet — there is not enough activity to assess overall status.`;
  }
  if (signals.length === 0) {
    return `No critical issues, overdue items, or unresolved risks were found ${scopeLabel}. Status is stable.`;
  }
  const top = signals[0];
  const topRef = top.projectName ? ` (${top.projectName})` : '';
  if (status === 'critical') return `Engineering delivery is at risk ${scopeLabel} because ${top.explanation}${topRef}.`;
  if (status === 'at_risk') return `${scopeLabel === 'on this project' ? 'The project' : 'Delivery'} is largely on track, but ${top.explanation}${topRef} and needs attention.`;
  return `Status is stable ${scopeLabel}. ${signals.length} routine item${signals.length === 1 ? '' : 's'} may be worth a look.`;
}
