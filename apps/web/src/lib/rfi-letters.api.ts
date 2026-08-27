import type { Project } from '@engineeringos/types';
import { apiGet, apiPost, apiPut } from './api';
import type { RfiListItem } from './rfis.api';

// ── Notice-of-impact letters (frontend built against the documented backend
// contract -- a parallel ticket is implementing these four routes right now:
//   GET  /projects/:projectId/rfis/:id/letter        -> RfiNoticeLetter | null
//   PUT  /projects/:projectId/rfis/:id/letter         -> RfiNoticeLetter
//   POST /projects/:projectId/rfis/:id/letter/share   -> RfiNoticeLetter
//   GET  /projects/:projectId/rfis/:id/letter/pdf     -> binary PDF
// ) ─────────────────────────────────────────────────────────────────────────

export type RfiNoticeLetterStatus = 'draft' | 'shared';

export interface RfiNoticeLetter {
  id: string;
  rfiId: string;
  recipientUserId: string;
  recipientTitle: string;
  body: string;
  status: RfiNoticeLetterStatus;
  sharedAt?: string;
  sharedBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function getRfiLetter(projectId: string, rfiId: string) {
  return apiGet<RfiNoticeLetter | null>(`/projects/${projectId}/rfis/${rfiId}/letter`);
}

export interface SaveRfiLetterPayload {
  recipientUserId: string;
  recipientTitle: string;
  body: string;
}

// PUT (not PATCH) -- a letter is created-or-replaced as a whole record,
// same "save draft" semantics the ticket calls for, no partial-update
// endpoint exists for it.
export function saveRfiLetter(projectId: string, rfiId: string, payload: SaveRfiLetterPayload) {
  return apiPut<RfiNoticeLetter>(`/projects/${projectId}/rfis/${rfiId}/letter`, payload);
}

export function shareRfiLetter(projectId: string, rfiId: string) {
  return apiPost<RfiNoticeLetter>(`/projects/${projectId}/rfis/${rfiId}/letter/share`);
}

// ── Default letter body template (frontend-only concern -- every field it
// needs is already available client-side: the RFI, the project, the current
// user, today's date) ────────────────────────────────────────────────────

// Humanizes a ProjectMember.role value (e.g. "project_lead") into a display
// title (e.g. "Project Lead") for the "{sender title}" template line.
// Decision (documented per ticket): use the current project member's role
// label when it's available; buildDefaultLetterBody() below leaves the
// line blank/editable when it isn't, rather than inventing a title.
export function formatMemberRole(role?: string): string {
  if (!role) return '';
  return role
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Matches this codebase's established date-formatting convention -- see
// formatDate() in rfi-constants.ts.
function formatToday(): string {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export type DefaultLetterBodyRfi = Pick<
  RfiListItem,
  | 'rfiNumber' | 'subject'
  | 'costImpactLevel' | 'costImpactAmount' | 'costImpactCurrency' | 'costImpactDescription'
  | 'timeImpactLevel' | 'timeImpactDays' | 'timeImpactDescription'
>;

export interface BuildDefaultLetterBodyParams {
  rfi: DefaultLetterBodyRfi;
  project?: Pick<Project, 'name' | 'code'> | null;
  recipientName: string;
  recipientTitle: string;
  senderName: string;
  senderTitle?: string;
}

// Builds the editable placeholder text a new letter starts from. Only ever
// called once, when a letter doesn't exist yet for this RFI -- an existing
// draft's real saved body is loaded as-is by the modal, never regenerated
// through this helper.
export function buildDefaultLetterBody(params: BuildDefaultLetterBodyParams): string {
  const { rfi, project, recipientName, recipientTitle, senderName, senderTitle } = params;

  const costApplies = rfi.costImpactLevel != null && rfi.costImpactLevel !== 'no';
  const timeApplies = rfi.timeImpactLevel != null && rfi.timeImpactLevel !== 'no';

  const kindUpper = costApplies && timeApplies ? 'COST AND TIME' : costApplies ? 'COST' : 'TIME';
  const kindLower = costApplies && timeApplies ? 'cost and time' : costApplies ? 'cost' : 'time';

  const recipientNameText = recipientName.trim() || '[Recipient Name]';
  const projectText = project ? `${project.name}${project.code ? ` (${project.code})` : ''}` : '—';
  const referenceText = `RFI ${rfi.rfiNumber ?? '—'} — ${rfi.subject}`;

  const lines: string[] = [
    `NOTICE OF ${kindUpper} IMPACT`,
    '',
    `To: ${recipientNameText}, ${recipientTitle}`,
    `From: ${senderName}`,
    `Date: ${formatToday()}`,
    `Project: ${projectText}`,
    `Reference: ${referenceText}`,
    '',
    'This letter serves as formal notice that the above-referenced RFI has been',
    `assessed as carrying a ${kindLower} impact to the Works.`,
    '',
  ];

  // Only include the Cost / Time paragraph if that impact actually applies.
  if (costApplies) {
    const amountText = rfi.costImpactAmount != null
      ? `${rfi.costImpactCurrency ? `${rfi.costImpactCurrency} ` : ''}${rfi.costImpactAmount}`
      : 'TBD';
    const descText = rfi.costImpactDescription ? ` — ${rfi.costImpactDescription}` : '';
    lines.push(`Cost impact: ${amountText}${descText}`);
  }
  if (timeApplies) {
    const daysText = rfi.timeImpactDays != null ? `${rfi.timeImpactDays} calendar days` : 'TBD';
    const descText = rfi.timeImpactDescription ? ` — ${rfi.timeImpactDescription}` : '';
    lines.push(`Time impact: ${daysText}${descText}`);
  }
  if (costApplies || timeApplies) lines.push('');

  lines.push(
    'This notice is issued to ensure the above impact is captured and accounted',
    'for in any related claim for additional cost and/or extension of time.',
    'Please review the referenced RFI and acknowledge receipt of this notice at',
    'your earliest convenience.',
    '',
    'Regards,',
    senderName,
    senderTitle ?? '',
  );

  return lines.join('\n');
}
