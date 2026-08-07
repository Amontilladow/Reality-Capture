import type { ProjectPhase } from './project.types';

export type IssueType = 'defect' | 'punch_item' | 'rfi' | 'coordination_clash' | 'safety_observation' | 'quality_hold' | 'inspection_point' | 'general';
export type IssuePriority = 'critical' | 'high' | 'medium' | 'low';
export type IssueStatus = 'open' | 'assigned' | 'in_progress' | 'resolved' | 'under_review' | 'closed' | 'void' | 'waiting_for_information' | 'reopened';

// Distinct from IssueType above (defect/rfi/coordination_clash/etc, which
// existed already) -- this is a separate classification axis added by the
// issue-tracker reconciliation (ticket 2a).
export type IssueDiscipline = 'MEP' | 'ARC' | 'STR' | 'CIV' | 'ELE' | 'INFRA' | 'LANDSCAPE' | 'OTHER';
export type IssueCategory =
  | 'design_issue' | 'bim_modeling_issue' | 'coordination_issue' | 'clash_detection'
  | 'constructability_issue' | 'shop_drawing_issue' | 'site_issue' | 'rfi'
  | 'client_comment' | 'consultant_comment' | 'other';

export interface Issue {
  id: string;
  companyId: string;
  projectId: string;
  buildingId?: string;
  levelId?: string;
  locationId?: string;
  elementId?: string;
  issueType: IssueType;
  issueNumber?: string;
  title: string;
  description?: string;
  priority: IssuePriority;
  discipline: IssueDiscipline;
  category?: IssueCategory;
  trade?: string;
  specificationRef?: string;
  status: IssueStatus;
  assignedTo?: string;
  responsibleCompany?: string;
  deadline?: string;
  closedAt?: string;
  closedBy?: string;
  captureId?: string;
  drawingId?: string;
  posXNorm?: number;
  posYNorm?: number;
  hotspotYaw?: number;
  hotspotPitch?: number;
  modelId?: string;
  cameraPosX?: number;
  cameraPosY?: number;
  cameraPosZ?: number;
  cameraTargetX?: number;
  cameraTargetY?: number;
  cameraTargetZ?: number;
  screenshotStorageKey?: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueActivity {
  id: string;
  issueId: string;
  companyId: string;
  activityType: 'comment' | 'status_change' | 'capture_added' | 'assigned' | 'closed'
    | 'forward' | 'reopened' | 'auto_warning' | 'manual_warning' | 'status_force' | 'reminder';
  content?: string;
  fromValue?: string;
  toValue?: string;
  captureId?: string;
  // File-attachment fields (ticket 2b / migration 022) -- always present
  // together on an attachment-carrying activity row, all three null on a
  // plain comment/status-change row.
  attachmentUrl?: string;
  attachmentName?: string;
  // BIGINT in Postgres -- node-postgres returns BIGINT columns as strings
  // (to avoid precision loss outside the JS safe-integer range), so this
  // is a string over the wire despite being a byte count.
  attachmentSizeBytes?: number | string;
  // Presigned read URL (~1hr expiry), resolved server-side from
  // attachmentUrl's raw storage key -- present only on activities that
  // actually have an attachment (absent, never null, otherwise).
  // attachmentUrl itself stays a raw storage key, not directly usable.
  attachmentReadUrl?: string;
  performedBy: string;
  createdAt: string;
}

// Log row for a sent reminder (issue_reminders table, migration 022).
export interface IssueReminder {
  id: string;
  companyId: string;
  projectId: string;
  issueId?: string;
  sentBy: string;
  sentTo?: string;
  message: string;
  createdAt: string;
}
