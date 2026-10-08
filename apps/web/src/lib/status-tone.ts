import type {
  IssueStatus, IssuePriority, RfiStatus, RfiWorkflowStatus, RfiPriority,
  SnagStatus, SnagPriority, SubmittalStatus, SubmittalPriority, TransmittalStatus, QaInspectionStatus,
  ProjectStatus, BimModelStatus, CaptureStatus,
} from '@engineeringos/types';

// One shared visual vocabulary for every status badge in the app. Every
// module (Issues, RFIs, Snagging, Submittals, Transmittals, QA, Projects,
// BIM models, Captures) defines its own status strings -- those differ on
// purpose and are NOT touched here -- but each one maps to one of these six
// tones, so "resolved" and "verified" and "approved" all read the same way
// even though they're different words in different modules.
//
// Colors match what IssuesPage/issue-constants.ts already shipped (bg-X/15
// text-X for most tones, danger gets /20 + border for critical since that's
// the one tone that needs to out-rank a plain "high priority" danger badge)
// -- this file centralizes that choice, it doesn't invent a new one.
export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger' | 'critical';

export const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-base-600 text-ink-500',
  info: 'bg-blueprint/15 text-blueprint',
  progress: 'bg-warn/15 text-warn',
  success: 'bg-ok/15 text-ok',
  warning: 'bg-warn/15 text-warn',
  danger: 'bg-danger/15 text-danger',
  critical: 'bg-danger/20 text-danger border border-danger/30',
};

// The small dot rendered inside <StatusBadge dot /> -- a plain background
// color per tone, used at low opacity text sizes where bg-X/15 text-X alone
// reads too flat to tell "progress" and "warning" apart from each other at
// a glance in a dense table row.
export const TONE_DOT_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-ink-500',
  info: 'bg-blueprint',
  progress: 'bg-warn',
  success: 'bg-ok',
  warning: 'bg-warn',
  danger: 'bg-danger',
  critical: 'bg-danger',
};

export const ISSUE_STATUS_TONE: Record<IssueStatus, StatusTone> = {
  open: 'info',
  assigned: 'progress',
  in_progress: 'progress',
  under_review: 'progress',
  waiting_for_information: 'progress',
  resolved: 'success',
  closed: 'neutral',
  reopened: 'danger',
  void: 'neutral',
};

// IssuePriority/RfiPriority/SnagPriority/SubmittalPriority are all the exact
// same 'critical'|'high'|'medium'|'low' union -- one shared map instead of
// four hand-copied duplicates, aliased per module below purely for
// call-site readability (ISSUE_PRIORITY_TONE reads better at an Issues call
// site than a generic PRIORITY_TONE would).
export const PRIORITY_TONE: Record<'critical' | 'high' | 'medium' | 'low', StatusTone> = {
  critical: 'critical',
  high: 'danger',
  medium: 'progress',
  low: 'neutral',
};

export const ISSUE_PRIORITY_TONE: Record<IssuePriority, StatusTone> = PRIORITY_TONE;

// Legacy RFI status ('open'/'answered'/'closed'/'void') -- still live for
// rows created before the Phase 1 workflow existed. See rfi.types.ts.
export const RFI_LEGACY_STATUS_TONE: Record<RfiStatus, StatusTone> = {
  open: 'info',
  answered: 'success',
  closed: 'neutral',
  void: 'neutral',
};

export const RFI_WORKFLOW_STATUS_TONE: Record<RfiWorkflowStatus, StatusTone> = {
  draft: 'neutral',
  open: 'info',
  submitted: 'info',
  under_review: 'progress',
  awaiting_clarification: 'progress',
  responded: 'success',
  answered: 'success',
  closed: 'neutral',
  rejected: 'danger',
  cancelled: 'neutral',
  void: 'neutral',
};

export const RFI_PRIORITY_TONE: Record<RfiPriority, StatusTone> = PRIORITY_TONE;

// 'open' here (an unfixed defect sitting unaddressed) is intentionally
// 'danger', not 'info' like Issues/RFIs' own 'open' -- matches
// snagging-constants.ts's original SNAG_STATUS_BADGE_CLASS, a deliberate
// product choice (a found-but-unfixed snag already IS the problem) this
// consolidation preserves rather than overrides.
export const SNAG_STATUS_TONE: Record<SnagStatus, StatusTone> = {
  open: 'danger',
  fixed: 'progress',
  verified: 'success',
  void: 'neutral',
};

export const SNAG_PRIORITY_TONE: Record<SnagPriority, StatusTone> = PRIORITY_TONE;

export const SUBMITTAL_STATUS_TONE: Record<SubmittalStatus, StatusTone> = {
  submitted: 'info',
  under_review: 'progress',
  approved: 'success',
  approved_as_noted: 'success',
  revise_and_resubmit: 'warning',
  rejected: 'danger',
  void: 'neutral',
};

export const SUBMITTAL_PRIORITY_TONE: Record<SubmittalPriority, StatusTone> = PRIORITY_TONE;

export const TRANSMITTAL_STATUS_TONE: Record<TransmittalStatus, StatusTone> = {
  draft: 'neutral',
  sent: 'info',
  acknowledged: 'success',
  void: 'neutral',
};

export const QA_INSPECTION_STATUS_TONE: Record<QaInspectionStatus, StatusTone> = {
  scheduled: 'neutral',
  in_progress: 'progress',
  passed: 'success',
  passed_with_exceptions: 'warning',
  failed: 'danger',
  void: 'neutral',
};

export const PROJECT_STATUS_TONE: Record<ProjectStatus, StatusTone> = {
  active: 'success',
  on_hold: 'warning',
  completed: 'neutral',
  archived: 'neutral',
};

export const BIM_MODEL_STATUS_TONE: Record<BimModelStatus, StatusTone> = {
  pending: 'neutral',
  processing: 'progress',
  ready: 'success',
  failed: 'danger',
};

export const CAPTURE_STATUS_TONE: Record<CaptureStatus, StatusTone> = {
  uploading: 'progress',
  processing: 'progress',
  ready: 'success',
  failed: 'danger',
};
