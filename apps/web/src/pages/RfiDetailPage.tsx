import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RFI_DISCIPLINE_LABELS, RFI_IMPACT_LEVELS, RFI_IMPACT_LEVEL_LABELS, RFI_DOCUMENT_TYPES, RFI_DOCUMENT_TYPE_LABELS,
  PROJECT_ORGANIZATION_SLOTS, PROJECT_ORGANIZATION_SLOT_LABELS,
  type RfiAttachmentKind, type RfiDocumentType, type ProjectOrganizationSlot, type RfiImpactLevel, type Rfi,
} from '@engineeringos/types';
import { PageHeader } from '../components/layout/PageHeader';
import { RichTextEditor, isRichTextEmpty } from '../components/ui/RichTextEditor';
import {
  getRfi, updateRfi, submitRfi, requestClarification, respondToRfi, closeRfi, reopenRfi,
  getRfiComments, addRfiComment, getRfiAttachments, uploadRfiAttachment, deleteRfiAttachment,
  type RfiAttachment,
} from '../lib/rfis.api';
import { getProject, getMembers, getPermissionGrants, getOrganizations } from '../lib/projects.api';
import { getProjectActivity } from '../lib/audit.api';
import { downloadRfiXls, type RfiWorkbookExtras } from '../lib/rfi-xls';
import {
  RFI_WORKFLOW_STATUS_LABELS, RFI_WORKFLOW_STATUS_BADGE_CLASS, RFI_PRIORITY_LABELS, RFI_PRIORITY_BADGE_CLASS,
} from '../lib/rfi-constants';
import { getDeadlineTimer, TIMER_BADGE_CLASS, formatDeadline, formatDateTime } from '../lib/issue-constants';
import { apiErrorMessage, apiDownload } from '../lib/api';
import { useAuthStore } from '../store/auth.store';

// Source-status sets mirroring rfis.service.ts's own (server-authoritative --
// this only decides which action BUTTONS are worth showing; the backend
// enforces the real state machine and 400s on an illegal transition either way).
const CLARIFICATION_SOURCE_STATUSES = new Set(['submitted', 'open', 'under_review']);
const RESPOND_SOURCE_STATUSES = new Set(['submitted', 'open', 'under_review', 'awaiting_clarification']);
const TERMINAL_STATUSES = new Set(['closed', 'rejected', 'cancelled', 'void']);

export default function RfiDetailPage() {
  const { projectId, rfiId } = useParams<{ projectId: string; rfiId: string }>();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const [questionDraft, setQuestionDraft] = useState('');
  const [answerDraft, setAnswerDraft] = useState('');
  const [costImpactLevel, setCostImpactLevel] = useState<RfiImpactLevel>('no');
  const [costImpactAmount, setCostImpactAmount] = useState('');
  const [costImpactCurrency, setCostImpactCurrency] = useState('');
  const [costImpactDescription, setCostImpactDescription] = useState('');
  const [timeImpactLevel, setTimeImpactLevel] = useState<RfiImpactLevel>('no');
  const [timeImpactDays, setTimeImpactDays] = useState('');
  const [timeImpactDescription, setTimeImpactDescription] = useState('');
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [clarifyReason, setClarifyReason] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [commentOrgSlot, setCommentOrgSlot] = useState<ProjectOrganizationSlot | ''>('');

  const rfiQuery = useQuery({
    queryKey: ['rfi', projectId, rfiId],
    queryFn: () => getRfi(projectId!, rfiId!),
    enabled: Boolean(projectId && rfiId),
  });

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  // Same query keys ManageMembersModal already uses for these two -- an RFI
  // page opened from a project a user is already a member of very likely
  // hits a warm cache instead of firing new requests.
  const membersQuery = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => getMembers(projectId!),
    enabled: Boolean(projectId),
  });
  const grantsQuery = useQuery({
    queryKey: ['permissionGrants', projectId],
    queryFn: () => getPermissionGrants(projectId!),
    enabled: Boolean(projectId),
  });

  const commentsQuery = useQuery({
    queryKey: ['rfi-comments', projectId, rfiId],
    queryFn: () => getRfiComments(projectId!, rfiId!),
    enabled: Boolean(projectId && rfiId),
  });

  const attachmentsQuery = useQuery({
    queryKey: ['rfi-attachments', projectId, rfiId],
    queryFn: () => getRfiAttachments(projectId!, rfiId!),
    enabled: Boolean(projectId && rfiId),
  });

  // Same queryKey OrganizationSlotRow uses below -- react-query shares the
  // one cached fetch between the two subscribers, so this doesn't add a
  // second network request. Needed here (not just inside OrganizationSlotRow)
  // so handleDownloadXls can thread the same already-loaded org data into
  // the XLS export the page already displays live.
  const organizationsQuery = useQuery({
    queryKey: ['project-organizations', projectId],
    queryFn: () => getOrganizations(projectId!),
    enabled: Boolean(projectId),
    retry: false,
  });

  // No dedicated "audit for one resource" endpoint exists -- fetch the
  // project's audit feed and filter client-side to this RFI, per the ticket.
  // perPage raised well above the project-activity widget's default (10) so
  // an RFI with a long history of transitions isn't silently truncated.
  const auditQuery = useQuery({
    queryKey: ['audit-project', projectId, 'rfi-detail'],
    queryFn: () => getProjectActivity(projectId!, 200),
    enabled: Boolean(projectId),
  });

  const rfi = rfiQuery.data;

  useEffect(() => {
    if (rfi) {
      setQuestionDraft(rfi.question ?? '');
      setAnswerDraft(rfi.answer ?? '');
      setCostImpactLevel(rfi.costImpactLevel ?? (rfi.costImpact ? 'yes' : 'no'));
      setCostImpactAmount(rfi.costImpactAmount != null ? String(rfi.costImpactAmount) : '');
      setCostImpactCurrency(rfi.costImpactCurrency ?? '');
      setCostImpactDescription(rfi.costImpactDescription ?? '');
      setTimeImpactLevel(rfi.timeImpactLevel ?? (rfi.timeImpact ? 'yes' : 'no'));
      setTimeImpactDays(rfi.timeImpactDays != null ? String(rfi.timeImpactDays) : '');
      setTimeImpactDescription(rfi.timeImpactDescription ?? '');
    }
  }, [rfi]);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['rfi', projectId, rfiId] });
    queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
    queryClient.invalidateQueries({ queryKey: ['rfi-summary', projectId] });
    // Every workflow transition writes an audit_log row -- keep the audit
    // trail panel in sync without requiring a manual page reload.
    queryClient.invalidateQueries({ queryKey: ['audit-project', projectId, 'rfi-detail'] });
  }

  // Saves the whole editable pre-response record in one PATCH -- question
  // plus cost/time impact -- rather than a separate mutation per field.
  // Triggered from both the RFI Information and Query section "Save"
  // buttons; either one saves everything, since both live under the same
  // canEditQuery gate and there's no reason to force two separate saves
  // for what's conceptually one editable record.
  const saveDraftMutation = useMutation({
    mutationFn: () => updateRfi(projectId!, rfiId!, {
      question: questionDraft,
      costImpactLevel,
      costImpactAmount: costImpactAmount.trim() ? Number(costImpactAmount) : undefined,
      costImpactCurrency: costImpactCurrency.trim() || undefined,
      costImpactDescription: costImpactDescription.trim() || undefined,
      timeImpactLevel,
      timeImpactDays: timeImpactDays.trim() ? Number(timeImpactDays) : undefined,
      timeImpactDescription: timeImpactDescription.trim() || undefined,
    }),
    onSuccess: invalidateAll,
  });

  const submitMutation = useMutation({
    mutationFn: () => submitRfi(projectId!, rfiId!),
    onSuccess: invalidateAll,
  });

  const clarifyMutation = useMutation({
    mutationFn: () => requestClarification(projectId!, rfiId!, clarifyReason.trim()),
    onSuccess: () => {
      setClarifyOpen(false);
      setClarifyReason('');
      invalidateAll();
    },
  });

  const respondMutation = useMutation({
    mutationFn: () => respondToRfi(projectId!, rfiId!, answerDraft),
    onSuccess: invalidateAll,
  });

  const closeMutation = useMutation({
    mutationFn: () => closeRfi(projectId!, rfiId!),
    onSuccess: invalidateAll,
  });

  const reopenMutation = useMutation({
    mutationFn: () => reopenRfi(projectId!, rfiId!),
    onSuccess: invalidateAll,
  });

  const commentMutation = useMutation({
    mutationFn: () => addRfiComment(projectId!, rfiId!, {
      body: commentBody.trim(),
      organizationSlot: commentOrgSlot || undefined,
    }),
    onSuccess: () => {
      setCommentBody('');
      setCommentOrgSlot('');
      queryClient.invalidateQueries({ queryKey: ['rfi-comments', projectId, rfiId] });
      queryClient.invalidateQueries({ queryKey: ['audit-project', projectId, 'rfi-detail'] });
    },
  });

  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  async function handleDownloadPdf() {
    if (!rfi) return;
    setDownloadError('');
    setDownloading(true);
    try {
      await apiDownload(`/projects/${projectId}/rfis/${rfi.id}/pdf`, `${rfi.rfiNumber ?? rfi.id}.pdf`);
    } catch (err) {
      setDownloadError(apiErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  const [xlsError, setXlsError] = useState('');
  const [xlsWarning, setXlsWarning] = useState('');
  const [xlsDownloading, setXlsDownloading] = useState(false);
  async function handleDownloadXls() {
    if (!rfi) return;
    setXlsError('');
    setXlsWarning('');
    setXlsDownloading(true);
    try {
      // rfi-xls.ts's Rfi.status is still the legacy-only vocabulary (see the
      // comment on Rfi.status in packages/types/src/rfi.types.ts). For an RFI
      // in one of the new workflow statuses, its RFI_STATUS_LABELS lookup
      // still renders blank for that one row -- a known, pre-existing gap,
      // not fixed here (out of scope: this ticket only threads the Phase 5
      // sections through, it doesn't touch the legacy status-label lookup).
      const extras: RfiWorkbookExtras = {
        organizations: (organizationsQuery.data ?? [])
          .filter((o) => o.name || o.logoUrl)
          .map((o) => ({ slot: o.slot, name: o.name, orgRef: o.orgRef, logoUrl: o.logoUrl })),
        queryStamp: rfi.queryStamp
          ? { uploadedBy: rfi.createdByName, dateTime: formatDateTime(rfi.updatedAt), stamp: rfi.queryStamp }
          : undefined,
        answerStamp: rfi.answerStamp
          ? { uploadedBy: rfi.answeredByName, dateTime: formatDateTime(rfi.answeredAt), stamp: rfi.answerStamp }
          : undefined,
        queryAttachments: queryAttachments.map((a) => ({
          filename: a.filename, documentType: a.documentType, documentTypeOther: a.documentTypeOther,
        })),
        responseAttachments: responseAttachments.map((a) => ({
          filename: a.filename, documentType: a.documentType, documentTypeOther: a.documentTypeOther,
        })),
      };
      const warnings = await downloadRfiXls(rfi as unknown as Rfi, projectQuery.data, extras);
      if (warnings.length > 0) setXlsWarning(warnings.join(' '));
    } catch (err) {
      setXlsError(apiErrorMessage(err));
    } finally {
      setXlsDownloading(false);
    }
  }

  if (!projectId || !rfiId) return null;

  if (rfiQuery.isLoading) {
    return (
      <>
        <PageHeader eyebrow={projectQuery.data?.name ?? 'Project'} title="RFI" />
        <div className="p-6 text-sm text-ink-500">Loading…</div>
      </>
    );
  }

  if (!rfi) {
    return (
      <>
        <PageHeader eyebrow={projectQuery.data?.name ?? 'Project'} title="RFI" />
        <div className="p-6 text-sm text-danger">RFI not found.</div>
      </>
    );
  }

  // ── Client-side permission gating (UX only) ─────────────────────────────
  // Optimistic/visual only -- the backend's @RequireProjectPermission +
  // canManageRfiReview() (rfis.service.ts) are the real enforcement and will
  // 403 on a mistaken client-side allow. Mirrors that same bypass set:
  // super_admin, project_lead, or a 'manage_rfis' grant.
  const isSuperAdmin = currentUser?.companyRole === 'super_admin';
  const myMembership = (membersQuery.data ?? []).find((m) => m.userId === currentUser?.id);
  const isProjectLead = myMembership?.role === 'project_lead';
  const hasManageRfisGrant = (grantsQuery.data ?? []).some(
    (g) => g.userId === currentUser?.id && g.permission === 'manage_rfis',
  );
  const canManageRfis = isSuperAdmin || isProjectLead || hasManageRfisGrant;
  const isCreator = rfi.createdBy === currentUser?.id;

  // Editable any time before a formal answer exists -- create() always sets
  // status='open' (there's no "save as draft" creation path yet), so gating
  // this to 'draft' alone made every RFI read-only the instant it was
  // created. 'open' is this RFI's pre-response lifecycle position (same as
  // 'draft'/'submitted'/'under_review'/'awaiting_clarification' below it),
  // so the query stays editable through all of those and locks once it's
  // actually been responded to or closed -- matches the "don't silently
  // overwrite the original query after it's been answered" rule.
  const RESPONDED_OR_TERMINAL = new Set(['responded', 'answered', ...TERMINAL_STATUSES]);
  const canEditQuery = !RESPONDED_OR_TERMINAL.has(rfi.status) && (isCreator || canManageRfis);
  const canSubmit = rfi.status === 'draft' && (isCreator || canManageRfis);
  const canRequestClarification = canManageRfis && CLARIFICATION_SOURCE_STATUSES.has(rfi.status);
  const canRespond = canManageRfis && RESPOND_SOURCE_STATUSES.has(rfi.status);
  const canClose = canManageRfis && !TERMINAL_STATUSES.has(rfi.status);
  const canReopen = canManageRfis && rfi.status === 'closed';

  const queryAttachments = (attachmentsQuery.data ?? []).filter((a) => (a.kind ?? 'query') === 'query');
  const responseAttachments = (attachmentsQuery.data ?? []).filter((a) => a.kind === 'response');
  const rfiAudit = (auditQuery.data ?? []).filter((a) => a.resourceType === 'rfi' && a.resourceId === rfiId);
  // getDeadlineTimer is typed for IssueStatus, but its only status-aware
  // branch is a plain string check against 'closed'/'void' -- both of which
  // are also legal RfiWorkflowStatus values, so this is functionally correct
  // at runtime; the cast only papers over the two enums not overlapping at
  // the type level. Reused verbatim per the ticket rather than forking a
  // second copy of the ok/warn/overdue timer logic for RFIs.
  const dueTimer = getDeadlineTimer(rfi.dueDate, rfi.status as never);

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title={rfi.rfiNumber ?? 'RFI'}
        actions={
          <Link to={`/projects/${projectId}/rfis`} className="btn-ghost !px-2 !py-1 text-xs">
            <BackIcon /> Back to RFIs
          </Link>
        }
      />

      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Title + status strip */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold mb-2">{rfi.subject}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`badge ${RFI_WORKFLOW_STATUS_BADGE_CLASS[rfi.status]}`}>{RFI_WORKFLOW_STATUS_LABELS[rfi.status]}</span>
              <span className={`badge ${RFI_PRIORITY_BADGE_CLASS[rfi.priority]}`}>{RFI_PRIORITY_LABELS[rfi.priority]}</span>
              {rfi.discipline && (
                <span className="badge bg-base-700 text-ink-500">
                  {RFI_DISCIPLINE_LABELS[rfi.discipline]}
                  {rfi.discipline === 'other' && rfi.disciplineOther ? ` — ${rfi.disciplineOther}` : ''}
                </span>
              )}
              <span className={`badge ${TIMER_BADGE_CLASS[dueTimer.state]}`} title={`Due ${formatDeadline(rfi.dueDate)}`}>
                {dueTimer.label}
              </span>
            </div>
          </div>
        </div>

        {/* 5-organization header row -- live since Phase 4 (project_organizations
            admin endpoints + ManageMembersModal's "Project Organizations"
            section). See OrganizationSlotRow below. */}
        <OrganizationSlotRow projectId={projectId} />

        {/* RFI Information */}
        <section className="panel tick-frame p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="field-label !mb-0">RFI Information</div>
            {canEditQuery && (
              <button
                onClick={() => saveDraftMutation.mutate()}
                disabled={saveDraftMutation.isPending}
                className="btn-secondary !px-3 !py-1.5 text-xs"
              >
                {saveDraftMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <InfoRow label="RFI Number" value={rfi.rfiNumber ?? '—'} mono />
            <InfoRow label="Discipline" value={rfi.discipline ? RFI_DISCIPLINE_LABELS[rfi.discipline] : '—'} />
            <InfoRow label="Priority" value={RFI_PRIORITY_LABELS[rfi.priority]} />
            <InfoRow label="Raised by" value={rfi.createdByName ?? '—'} />
            <InfoRow label="Assigned to" value={rfi.assignedToName ?? 'Unassigned'} />
            <InfoRow label="Due date" value={formatDeadline(rfi.dueDate)} />
            <InfoRow label="Created" value={formatDateTime(rfi.createdAt)} />
            {rfi.answeredAt && <InfoRow label="Answered" value={formatDateTime(rfi.answeredAt)} />}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-base-600">
            {canEditQuery ? (
              <>
                <ImpactEditor
                  title="Cost impact"
                  level={costImpactLevel}
                  onLevelChange={setCostImpactLevel}
                  amount={costImpactAmount}
                  onAmountChange={setCostImpactAmount}
                  currency={costImpactCurrency}
                  onCurrencyChange={setCostImpactCurrency}
                  description={costImpactDescription}
                  onDescriptionChange={setCostImpactDescription}
                />
                <ImpactEditor
                  title="Time impact"
                  level={timeImpactLevel}
                  onLevelChange={setTimeImpactLevel}
                  days={timeImpactDays}
                  onDaysChange={setTimeImpactDays}
                  description={timeImpactDescription}
                  onDescriptionChange={setTimeImpactDescription}
                />
              </>
            ) : (
              <>
                <ImpactSummary
                  title="Cost impact"
                  level={rfi.costImpactLevel}
                  legacyBool={rfi.costImpact}
                  amount={rfi.costImpactAmount}
                  currency={rfi.costImpactCurrency}
                  description={rfi.costImpactDescription}
                />
                <ImpactSummary
                  title="Time impact"
                  level={rfi.timeImpactLevel}
                  legacyBool={rfi.timeImpact}
                  days={rfi.timeImpactDays}
                  description={rfi.timeImpactDescription}
                />
              </>
            )}
          </div>
        </section>

        {/* Query */}
        <section className="panel tick-frame p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="field-label !mb-0">Query</div>
            {canEditQuery && (
              <button
                onClick={() => saveDraftMutation.mutate()}
                disabled={saveDraftMutation.isPending}
                className="btn-secondary !px-3 !py-1.5 text-xs"
              >
                {saveDraftMutation.isPending ? 'Saving…' : 'Save draft'}
              </button>
            )}
          </div>
          <RichTextEditor
            value={questionDraft}
            onChange={setQuestionDraft}
            readOnly={!canEditQuery}
            placeholder="Describe the question that needs a formal answer…"
          />
          {saveDraftMutation.isError && <p className="field-error">{apiErrorMessage(saveDraftMutation.error)}</p>}

          {rfi.queryStamp && (
            <StampPanel
              title="Query upload stamp"
              uploadedBy={rfi.createdByName}
              // rfis.service.ts's submit() writes query_stamp but there is no
              // dedicated submittedAt column -- updatedAt is the closest
              // available timestamp for "when the stamp was generated"
              // (submit() is the only thing that updates the row at that
              // point). Judgment call, flagged for review.
              dateTime={rfi.updatedAt}
              stamp={rfi.queryStamp}
            />
          )}

          <AttachmentSection
            projectId={projectId}
            rfiId={rfiId}
            kind="query"
            attachments={queryAttachments}
            canUpload
            onChanged={() => queryClient.invalidateQueries({ queryKey: ['rfi-attachments', projectId, rfiId] })}
          />
        </section>

        {/* Communication / Clarifications */}
        <section className="panel tick-frame p-5 space-y-3">
          <div className="field-label">Communication / Clarifications ({commentsQuery.data?.length ?? 0})</div>
          <div className="space-y-2">
            {(commentsQuery.data ?? []).map((c) => (
              <div key={c.id} className="bg-base-700/40 rounded px-3 py-2 text-sm">
                <div className="flex items-center gap-2 text-xs text-ink-500 mb-1">
                  <span className="font-medium text-ink-300">{c.userName ?? 'Someone'}</span>
                  {c.organizationSlot && (
                    <span className="badge bg-base-600 text-ink-500">{PROJECT_ORGANIZATION_SLOT_LABELS[c.organizationSlot]}</span>
                  )}
                  <span className="ml-auto">{formatDateTime(c.createdAt)}</span>
                </div>
                <p className="text-ink-100 whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
            {commentsQuery.isSuccess && commentsQuery.data?.length === 0 && (
              <p className="text-sm text-ink-500">No comments yet.</p>
            )}
          </div>

          <div className="flex gap-2 items-start pt-1">
            <select
              className="field-input w-auto shrink-0"
              value={commentOrgSlot}
              onChange={(e) => setCommentOrgSlot(e.target.value as ProjectOrganizationSlot | '')}
              title="Speaking on behalf of…"
            >
              <option value="">No org tag</option>
              {PROJECT_ORGANIZATION_SLOTS.map((slot) => (
                <option key={slot} value={slot}>{PROJECT_ORGANIZATION_SLOT_LABELS[slot]}</option>
              ))}
            </select>
            <input
              className="field-input"
              placeholder="Add a comment…"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && commentBody.trim()) commentMutation.mutate(); }}
            />
            <button
              onClick={() => commentMutation.mutate()}
              disabled={!commentBody.trim() || commentMutation.isPending}
              className="btn-primary !px-4 shrink-0"
            >
              Send
            </button>
          </div>
          {commentMutation.isError && <p className="field-error">{apiErrorMessage(commentMutation.error)}</p>}
        </section>

        {/* Response / Answer */}
        <section className="panel tick-frame p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="field-label !mb-0">Response</div>
          </div>
          <RichTextEditor
            value={answerDraft}
            onChange={setAnswerDraft}
            readOnly={!canRespond}
            placeholder="Write the formal response…"
          />
          {respondMutation.isError && <p className="field-error">{apiErrorMessage(respondMutation.error)}</p>}

          {rfi.answerStamp && (
            <StampPanel
              title="Answer upload stamp"
              uploadedBy={rfi.answeredByName}
              dateTime={rfi.answeredAt}
              stamp={rfi.answerStamp}
            />
          )}

          <AttachmentSection
            projectId={projectId}
            rfiId={rfiId}
            kind="response"
            attachments={responseAttachments}
            canUpload={canManageRfis}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ['rfi-attachments', projectId, rfiId] })}
          />
        </section>

        {/* Audit trail */}
        <section className="panel tick-frame p-5 space-y-2">
          <div className="field-label">Audit trail</div>
          {rfiAudit.length === 0 && <p className="text-sm text-ink-500">No audit events recorded for this RFI yet.</p>}
          <div className="space-y-1.5">
            {rfiAudit.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-xs text-ink-500">
                <span className="font-mono text-ink-300">{a.action}</span>
                <span>·</span>
                <span>{a.userName ?? 'System'}</span>
                <span className="ml-auto">{formatDateTime(a.occurredAt)}</span>
              </div>
            ))}
          </div>
        </section>

        {downloadError && <p className="field-error">{downloadError}</p>}
        {xlsError && <p className="field-error">{xlsError}</p>}
        {xlsWarning && <p className="text-xs text-warn">{xlsWarning}</p>}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-base-600">
          {canSubmit && (
            <button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending} className="btn-primary !px-3 !py-1.5 text-xs">
              {submitMutation.isPending ? 'Submitting…' : 'Submit'}
            </button>
          )}

          {canRequestClarification && !clarifyOpen && (
            <button onClick={() => setClarifyOpen(true)} className="btn-secondary !px-3 !py-1.5 text-xs">
              Request clarification
            </button>
          )}
          {canRequestClarification && clarifyOpen && (
            <div className="flex items-center gap-2">
              <input
                className="field-input !py-1.5 text-xs"
                placeholder="Reason…"
                value={clarifyReason}
                onChange={(e) => setClarifyReason(e.target.value)}
              />
              <button
                onClick={() => clarifyMutation.mutate()}
                disabled={!clarifyReason.trim() || clarifyMutation.isPending}
                className="btn-primary !px-3 !py-1.5 text-xs"
              >
                Send
              </button>
              <button onClick={() => setClarifyOpen(false)} className="btn-ghost !px-2 !py-1.5 text-xs">Cancel</button>
            </div>
          )}
          {clarifyMutation.isError && <p className="field-error">{apiErrorMessage(clarifyMutation.error)}</p>}

          {canRespond && (
            <button
              onClick={() => respondMutation.mutate()}
              disabled={isRichTextEmpty(answerDraft) || respondMutation.isPending}
              className="btn-primary !px-3 !py-1.5 text-xs"
            >
              {respondMutation.isPending ? 'Submitting…' : 'Respond'}
            </button>
          )}
          {canClose && (
            <button onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              Close RFI
            </button>
          )}
          {canReopen && (
            <button onClick={() => reopenMutation.mutate()} disabled={reopenMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              ↩ Reopen
            </button>
          )}

          <button onClick={handleDownloadPdf} disabled={downloading} className="btn-secondary !px-3 !py-1.5 text-xs ml-auto">
            {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
          <button
            onClick={handleDownloadXls}
            disabled={xlsDownloading}
            className="btn-secondary !px-3 !py-1.5 text-xs"
            title="Editable spreadsheet, formatted to match the PDF"
          >
            {xlsDownloading ? 'Preparing…' : 'Download XLS'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Small presentational pieces ─────────────────────────────────────────────

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`text-ink-100 font-medium ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}

function ImpactSummary({
  title, level, legacyBool, amount, currency, days, description,
}: {
  title: string;
  level?: 'no' | 'yes' | 'potential' | 'tbd';
  legacyBool?: boolean;
  amount?: number;
  currency?: string;
  days?: number;
  description?: string;
}) {
  // Falls back to the legacy boolean when the 4-state level field is absent
  // (RFIs created before this field existed) -- same precedence rfis.service.ts
  // itself uses server-side.
  const effectiveLevel = level ?? (legacyBool ? 'yes' : 'no');
  const showDetails = effectiveLevel !== 'no';
  return (
    <div>
      <div className="text-xs text-ink-500 mb-1">{title}</div>
      <span className={`badge ${showDetails ? 'bg-warn/15 text-warn' : 'bg-base-600 text-ink-500'}`}>
        {RFI_IMPACT_LEVEL_LABELS[effectiveLevel]}
      </span>
      {showDetails && (
        <div className="mt-1.5 text-sm text-ink-300 space-y-0.5">
          {amount != null && <div>{currency ? `${currency} ` : ''}{amount}</div>}
          {days != null && <div>{days} day{days === 1 ? '' : 's'}</div>}
          {description && <p className="text-xs text-ink-500 whitespace-pre-wrap">{description}</p>}
        </div>
      )}
    </div>
  );
}

// Editable counterpart to ImpactSummary, shown instead of it while
// canEditQuery is true. Amount/currency (cost) or days (time) plus a
// description only make sense once the level says there's some impact --
// same "showDetails" gate ImpactSummary already uses for display.
function ImpactEditor({
  title, level, onLevelChange, amount, onAmountChange, currency, onCurrencyChange,
  days, onDaysChange, description, onDescriptionChange,
}: {
  title: string;
  level: RfiImpactLevel;
  onLevelChange: (level: RfiImpactLevel) => void;
  amount?: string;
  onAmountChange?: (value: string) => void;
  currency?: string;
  onCurrencyChange?: (value: string) => void;
  days?: string;
  onDaysChange?: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
}) {
  const showDetails = level !== 'no';
  return (
    <div>
      <div className="text-xs text-ink-500 mb-1">{title}</div>
      <select
        className="field-input !py-1.5 text-xs w-auto"
        value={level}
        onChange={(e) => onLevelChange(e.target.value as RfiImpactLevel)}
      >
        {RFI_IMPACT_LEVELS.map((l) => (
          <option key={l} value={l}>{RFI_IMPACT_LEVEL_LABELS[l]}</option>
        ))}
      </select>
      {showDetails && (
        <div className="mt-2 space-y-1.5">
          {onAmountChange && (
            <div className="flex gap-1.5">
              <input
                className="field-input !py-1.5 text-xs w-20"
                placeholder="Currency"
                value={currency ?? ''}
                onChange={(e) => onCurrencyChange?.(e.target.value)}
              />
              <input
                type="number"
                className="field-input !py-1.5 text-xs flex-1"
                placeholder="Estimated amount (optional)"
                value={amount ?? ''}
                onChange={(e) => onAmountChange(e.target.value)}
              />
            </div>
          )}
          {onDaysChange && (
            <input
              type="number"
              className="field-input !py-1.5 text-xs w-full"
              placeholder="Estimated days (optional)"
              value={days ?? ''}
              onChange={(e) => onDaysChange(e.target.value)}
            />
          )}
          <textarea
            className="field-input !py-1.5 text-xs w-full min-h-[50px]"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function StampPanel({
  title, uploadedBy, dateTime, stamp,
}: {
  title: string;
  uploadedBy?: string;
  dateTime?: string;
  stamp: string;
}) {
  return (
    <div className="tick-frame bg-base-900/60 border border-base-600 rounded px-3 py-2.5">
      <div className="text-[10px] font-mono uppercase tracking-widest text-blueprint mb-1.5">{title}</div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-ink-500">Uploaded by</div>
          <div className="text-ink-100">{uploadedBy ?? '—'}</div>
        </div>
        <div>
          <div className="text-ink-500">Date-time</div>
          <div className="text-ink-100">{formatDateTime(dateTime)}</div>
        </div>
        <div>
          <div className="text-ink-500">Stamp</div>
          <div className="text-ink-100 font-mono">{stamp}</div>
        </div>
      </div>
    </div>
  );
}

// Five stakeholder slots, per project -- live since Phase 4. A slot with no
// configured row (or while the query is loading, or if it errors -- e.g. a
// viewer without the 'manage_team' permission this endpoint is gated on)
// simply renders the same placeholder as before; this never blocks or
// errors the rest of the page.
function OrganizationSlotRow({ projectId }: { projectId: string }) {
  const organizationsQuery = useQuery({
    queryKey: ['project-organizations', projectId],
    queryFn: () => getOrganizations(projectId),
    enabled: Boolean(projectId),
    retry: false,
  });
  const bySlot = new Map((organizationsQuery.data ?? []).map((o) => [o.slot, o]));

  return (
    <section className="panel tick-frame p-4">
      <div className="grid grid-cols-5 gap-3">
        {PROJECT_ORGANIZATION_SLOTS.map((slot) => {
          const org = bySlot.get(slot);
          return (
            <div key={slot} className="flex flex-col items-center gap-1.5 text-center">
              {org?.logoUrl ? (
                <img
                  src={org.logoUrl}
                  alt={org.name ?? PROJECT_ORGANIZATION_SLOT_LABELS[slot]}
                  className="w-14 h-14 object-contain rounded border border-base-600 bg-white"
                />
              ) : (
                <div className="w-14 h-14 rounded border border-dashed border-base-600 bg-base-900/60 flex items-center justify-center text-ink-500 text-[10px]">
                  No logo
                </div>
              )}
              <div className="text-[10px] uppercase tracking-wide text-ink-500 font-mono">{PROJECT_ORGANIZATION_SLOT_LABELS[slot]}</div>
              {org?.name && <div className="text-xs text-ink-100 truncate max-w-full">{org.name}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AttachmentSection({
  projectId, rfiId, kind, attachments, canUpload, onChanged,
}: {
  projectId: string;
  rfiId: string;
  kind: RfiAttachmentKind;
  attachments: RfiAttachment[];
  canUpload: boolean;
  onChanged: () => void;
}) {
  const [documentType, setDocumentType] = useState<RfiDocumentType>('other');

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadRfiAttachment(projectId, rfiId, file, { kind, documentType }),
    onSuccess: onChanged,
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteRfiAttachment(projectId, rfiId, attachmentId),
    onSuccess: onChanged,
  });

  return (
    <div>
      <div className="field-label mb-1.5">{kind === 'query' ? 'Query attachments' : 'Response attachments'}</div>
      {attachments.length === 0 && <p className="text-xs text-ink-500 mb-2">No files attached yet.</p>}
      {attachments.length > 0 && (
        <div className="overflow-x-auto mb-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-500 border-b border-base-600">
                <th className="py-1.5 pr-3 font-medium">File</th>
                <th className="py-1.5 pr-3 font-medium">Document type</th>
                <th className="py-1.5 pr-3 font-medium">Revision</th>
                <th className="py-1.5 pr-3 font-medium">Uploaded by</th>
                <th className="py-1.5 pr-3 font-medium">Date</th>
                <th className="py-1.5 pr-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {attachments.map((a) => (
                <tr key={a.id} className="border-b border-base-700/60 last:border-0">
                  <td className="py-1.5 pr-3">
                    {a.attachmentReadUrl ? (
                      <a href={a.attachmentReadUrl} target="_blank" rel="noreferrer" className="text-blueprint hover:text-blueprint-hover underline">
                        {a.filename}
                      </a>
                    ) : (
                      <span className="text-ink-300">{a.filename}</span>
                    )}
                    <span className="text-ink-500"> ({formatBytes(Number(a.sizeBytes))})</span>
                  </td>
                  <td className="py-1.5 pr-3 text-ink-300">
                    {a.documentType ? RFI_DOCUMENT_TYPE_LABELS[a.documentType] : '—'}
                    {a.documentType === 'other' && a.documentTypeOther ? ` — ${a.documentTypeOther}` : ''}
                  </td>
                  <td className="py-1.5 pr-3 text-ink-300">{a.revision ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-ink-300">{a.uploadedByName ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-ink-300">{formatDateTime(a.uploadedAt)}</td>
                  <td className="py-1.5 text-right">
                    {canUpload && (
                      <button onClick={() => deleteMutation.mutate(a.id)} disabled={deleteMutation.isPending} className="text-danger hover:text-danger/80" title="Remove">
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {uploadMutation.isError && <p className="field-error">{apiErrorMessage(uploadMutation.error)}</p>}
      {canUpload && (
        <div className="flex items-center gap-2">
          <select className="field-input w-auto !py-1.5 text-xs" value={documentType} onChange={(e) => setDocumentType(e.target.value as RfiDocumentType)}>
            {RFI_DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{RFI_DOCUMENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <label className="btn-secondary !px-3 !py-1.5 text-xs cursor-pointer">
            {uploadMutation.isPending ? 'Uploading…' : '+ Upload document'}
            <input
              type="file"
              className="hidden"
              disabled={uploadMutation.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMutation.mutate(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
