// Legacy status vocabulary -- still the only values any RFI created through
// the old create()/update() methods can carry. Kept as live legal values
// (both at the DB CHECK constraint and here) since existing rows use them
// and the current, unmodified-in-Phase-1 frontend filters on them.
export type RfiLegacyStatus = 'open' | 'answered' | 'closed' | 'void';
export type RfiStatus = RfiLegacyStatus;
export type RfiPriority = 'critical' | 'high' | 'medium' | 'low';

// Full enterprise workflow vocabulary (Phase 1). 'open' and 'answered' are
// the legacy names for the same lifecycle positions as 'submitted' and
// 'responded' respectively -- new workflow endpoints (rfis.service.ts
// submit()/requestClarification()/respond()/close()/reopen()) never WRITE
// 'open'/'answered', only read/transition-from them for pre-existing rows.
export const RFI_WORKFLOW_STATUSES = [
  'draft',
  'open',
  'submitted',
  'under_review',
  'awaiting_clarification',
  'responded',
  'answered',
  'closed',
  'rejected',
  'cancelled',
  'void',
] as const;

export type RfiWorkflowStatus = typeof RFI_WORKFLOW_STATUSES[number];

export const RFI_WORKFLOW_STATUS_LABELS: Record<RfiWorkflowStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  submitted: 'Submitted',
  under_review: 'Under Review',
  awaiting_clarification: 'Awaiting Clarification',
  responded: 'Responded',
  answered: 'Answered',
  closed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  void: 'Void',
};

// 4-state cost/time impact level, replacing the plain boolean going
// forward (the boolean columns/DTO fields stay for backward compatibility
// -- see rfi.types.ts consumers in rfis.service.ts).
export type RfiImpactLevel = 'no' | 'yes' | 'potential' | 'tbd';

export const RFI_IMPACT_LEVELS: readonly RfiImpactLevel[] = ['no', 'yes', 'potential', 'tbd'] as const;

export const RFI_IMPACT_LEVEL_LABELS: Record<RfiImpactLevel, string> = {
  no: 'No',
  yes: 'Yes',
  potential: 'Potential',
  tbd: 'TBD',
};

// Same underlying 4-state values as RfiImpactLevel above (no schema change,
// no new enum values -- see migration 044/045) but with the field-specific
// wording requested for "Drawing/Model Updated": 'potential'/'tbd' aren't
// generic "maybe" states here, they're two distinct reasons a drawing/model
// update is still undecided. Kept as its own label map rather than
// overloading RFI_IMPACT_LEVEL_LABELS, which cost/time impact still use
// unchanged.
export const DRAWING_UPDATE_STATUS_LABELS: Record<RfiImpactLevel, string> = {
  no: 'No',
  yes: 'Yes',
  potential: 'TBC (Awaiting Engineer Decision)',
  tbd: 'TBC (Subject to Time/Cost Approval)',
};

// Five named stakeholder organization slots, one per project, each with its
// own logo for the RFI PDF header (project_organizations table).
export const PROJECT_ORGANIZATION_SLOTS = [
  'client',
  'pmc',
  'ldc',
  'main_contractor',
  'subcontractor',
] as const;

export type ProjectOrganizationSlot = typeof PROJECT_ORGANIZATION_SLOTS[number];

export const PROJECT_ORGANIZATION_SLOT_LABELS: Record<ProjectOrganizationSlot, string> = {
  client: 'Client',
  pmc: 'PMC',
  ldc: 'Lead Design Consultant',
  main_contractor: 'Main Contractor',
  subcontractor: 'Subcontractor',
};

// rfi_attachments.kind -- which side of the record the file belongs to.
export type RfiAttachmentKind = 'query' | 'response' | 'comment';

export const RFI_ATTACHMENT_KINDS: readonly RfiAttachmentKind[] = ['query', 'response', 'comment'] as const;

export const RFI_DOCUMENT_TYPES = [
  'drawing',
  'specification',
  'method_statement',
  'calculation',
  'schedule',
  'photo',
  'contract',
  'email',
  'site_instruction',
  'submittal',
  'model',
  'bim',
  'report',
  'other',
] as const;

export type RfiDocumentType = typeof RFI_DOCUMENT_TYPES[number];

export const RFI_DOCUMENT_TYPE_LABELS: Record<RfiDocumentType, string> = {
  drawing: 'Drawing',
  specification: 'Specification',
  method_statement: 'Method Statement',
  calculation: 'Calculation',
  schedule: 'Schedule',
  photo: 'Photo',
  contract: 'Contract',
  email: 'Email',
  site_instruction: 'Site Instruction',
  submittal: 'Submittal',
  model: 'Model',
  bim: 'BIM',
  report: 'Report',
  other: 'Other',
};

export const RFI_DISCIPLINES = [
  'civil',
  'structural',
  'architectural',
  'interior_design',
  'mechanical',
  'electrical',
  'plumbing',
  'hvac',
  'general',
  'infra',
  'mep_general',
  'elv',
  'av',
  'other',
] as const;

export type RfiDiscipline = typeof RFI_DISCIPLINES[number];

export const RFI_DISCIPLINE_LABELS: Record<RfiDiscipline, string> = {
  civil: 'Civil',
  structural: 'Structural',
  architectural: 'Architectural',
  interior_design: 'Interior Design',
  mechanical: 'Mechanical',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  general: 'General',
  infra: 'Infra',
  mep_general: 'MEP (General)',
  elv: 'ELV',
  av: 'AV',
  other: 'Other',
};

// Short codes used in the RFI numbering scheme:
// {ProjectCode}-{OrgCode}-RFI-{DisciplineCode}-{0001}
export const RFI_DISCIPLINE_CODES: Record<RfiDiscipline, string> = {
  civil: 'CIV',
  structural: 'STR',
  architectural: 'ARC',
  interior_design: 'ID',
  mechanical: 'MEC',
  electrical: 'ELE',
  plumbing: 'PLM',
  hvac: 'HVAC',
  general: 'GEN',
  infra: 'INFRA',
  mep_general: 'MEP',
  elv: 'ELV',
  av: 'AV',
  other: 'OTH',
};

// External stakeholder access -- lets a Lead Design Consultant/PMC/Client
// respond to or review an RFI via an opaque, expiring, revocable link with
// no EngineeringOS account (rfi_external_access table, migration 043).
export const RFI_EXTERNAL_ACCESS_ACTIONS = ['respond', 'review', 'comment_only'] as const;
export type RfiExternalAccessAction = typeof RFI_EXTERNAL_ACCESS_ACTIONS[number];

export const RFI_EXTERNAL_ACCESS_ACTION_LABELS: Record<RfiExternalAccessAction, string> = {
  respond: 'Respond',
  review: 'Review (approve/reject)',
  comment_only: 'Comment only',
};

// One row per generated link. `token` is only ever present in the response
// to the generate call itself -- list/revoke responses omit it (see
// RfiExternalAccessService), same "don't re-display a bearer secret"
// practice as this codebase already applies to other credential-shaped
// values.
export interface RfiExternalAccess {
  id: string;
  companyId: string;
  projectId: string;
  rfiId: string;
  organizationSlot: ProjectOrganizationSlot;
  action: RfiExternalAccessAction;
  recipientEmail: string;
  recipientName?: string;
  token?: string;
  expiresAt: string;
  revokedAt?: string;
  revokedBy?: string;
  usedAt?: string;
  createdBy: string;
  createdAt: string;
}

// The deliberately narrow read model GET /public/rfis/external/:token
// returns -- subject/question/discipline/due date, this RFI's own
// query-kind attachments and comment thread, and which action this
// specific link authorizes. Never the wider findOne() shape, never
// anything about other RFIs or the rest of the project.
export interface RfiExternalDetail {
  rfiNumber?: string;
  subject: string;
  question: string;
  discipline?: RfiDiscipline;
  disciplineOther?: string;
  status: RfiWorkflowStatus;
  dueDate?: string;
  answer?: string;
  action: RfiExternalAccessAction;
  organizationSlot: ProjectOrganizationSlot;
  attachments: { id: string; filename: string; attachmentReadUrl?: string }[];
  comments: { id: string; userName?: string; organizationSlot?: ProjectOrganizationSlot; body: string; createdAt: string }[];
}

export interface Rfi {
  id: string;
  companyId: string;
  projectId: string;
  rfiNumber?: string;
  subject: string;
  question: string;
  answer?: string;
  // NOTE (Phase 3 finding, not fixed here): the backend's
  // submit/requestClarification/respond/close/reopen endpoints
  // (rfis.service.ts) actually write the wider RfiWorkflowStatus vocabulary
  // into this same column, so this legacy-only type is inaccurate for those
  // rows. Left as RfiStatus rather than widened here because rfi-xls.ts
  // indexes RFI_STATUS_LABELS (Record<RfiStatus, string>) with `rfi.status`
  // and is explicitly out of scope for this ticket ("do not touch
  // rfi-pdf.template.ts or rfi-xls.ts") -- widening this field breaks that
  // file's typecheck. apps/web/src/lib/rfis.api.ts's RfiListItem widens
  // status to RfiWorkflowStatus locally for the pages that need it instead.
  status: RfiStatus;
  priority: RfiPriority;
  discipline?: RfiDiscipline;
  disciplineOther?: string;
  costImpact: boolean;
  timeImpact: boolean;
  // 4-state impact fields (Phase 1) -- kept in sync with the booleans above
  // by the service layer; see costImpact/timeImpact for the legacy shape.
  costImpactLevel?: RfiImpactLevel;
  costImpactAmount?: number;
  costImpactCurrency?: string;
  costImpactDescription?: string;
  timeImpactLevel?: RfiImpactLevel;
  timeImpactDays?: number;
  timeImpactDescription?: string;
  // Third impact field (migration 044), structurally identical to cost/time
  // above but with no amount/currency-or-days companion -- just level +
  // description. drawingUpdateApplied only means anything once
  // drawingImpactLevel != 'no' (see RfisService's own comment).
  drawingImpactLevel?: RfiImpactLevel;
  drawingImpactDescription?: string;
  drawingUpdateOwnerId?: string;
  drawingUpdateApplied?: boolean;
  drawingUpdateAppliedAt?: string;
  drawingUpdateAppliedBy?: string;
  // A separate milestone from drawingUpdateApplied (migration 045): whether
  // the updated drawing/model was actually distributed to the site team,
  // not just updated. Same "only means anything once drawingImpactLevel !=
  // 'no'" rule.
  drawingUpdateSentToSite?: boolean;
  drawingUpdateSentToSiteAt?: string;
  drawingUpdateSentToSiteBy?: string;
  queryStamp?: string;
  answerStamp?: string;
  assignedTo?: string;
  dueDate?: string;
  answeredAt?: string;
  answeredBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // Joined
  createdByName?: string;
  assignedToName?: string;
  // rfis.service.ts findOne()/getPdfData() already join and return this
  // (u_ans.first_name || ' ' || u_ans.last_name AS answered_by_name) -- it
  // was missing from this interface even though the backend has always sent
  // it. Added here rather than worked around with an `as` cast at every
  // call site.
  answeredByName?: string;
  // Joined name for drawingUpdateOwnerId -- undefined when no owner is set
  // (the detail/list views show "Unassigned" in that case, same as
  // assignedToName). The assignedTo fallback the reminder endpoint and the
  // Reports not-applied list use only applies at the point of resolving who
  // to notify -- it's not baked into this field.
  drawingUpdateOwnerName?: string;
}
