import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RFI_DISCIPLINE_LABELS, RFI_DOCUMENT_TYPES, RFI_DOCUMENT_TYPE_LABELS, type RfiDocumentType } from '@engineeringos/types';
import { PageHeader } from '../components/layout/PageHeader';
import { InlineRiskAssessment } from '../components/RiskIntelligenceSection';
import {
  getQaqcRecord, respondToQaqcRecord, confirmQaqcRecord,
  getQaqcAttachments, uploadQaqcAttachment, deleteQaqcAttachment,
  getQaqcCaptures, linkQaqcCapture,
  type QaqcAttachment, type QaqcAttachmentKind, type QaqcRecordType, type QaqcLinkedCapture,
} from '../lib/qaqc.api';
import { uploadCapture } from '../lib/captures.api';
import { getProject } from '../lib/projects.api';
import {
  QAQC_STATUS_LABELS, QAQC_PRIORITY_LABELS, QAQC_RECORD_TYPE_SHORT_LABELS, QAQC_ISSUE_ROLES_BY_TYPE, QAQC_RESPOND_ROLES_BY_TYPE, QAQC_CONFIRM_ROLES,
  QAQC_STATUS_TONE, QAQC_PRIORITY_TONE, formatDate, formatDateTime,
} from '../lib/qaqc-constants';
import { StatusBadge } from '../components/ui/Badge';
import { apiErrorMessage, apiDownload } from '../lib/api';
import { useAuthStore } from '../store/auth.store';
import { Listbox } from '../components/ui/Listbox';

export default function QaqcDetailPage() {
  const { projectId, recordType, id } = useParams<{ projectId: string; recordType: QaqcRecordType; id: string }>();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [responseDraft, setResponseDraft] = useState('');
  const [confirmComment, setConfirmComment] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const recordQuery = useQuery({
    queryKey: ['qaqc-record', projectId, id],
    queryFn: () => getQaqcRecord(projectId!, id!),
    enabled: Boolean(projectId && id),
  });

  const attachmentsQuery = useQuery({
    queryKey: ['qaqc-attachments', projectId, id],
    queryFn: () => getQaqcAttachments(projectId!, id!),
    enabled: Boolean(projectId && id),
  });

  const capturesQuery = useQuery({
    queryKey: ['qaqc-captures', projectId, id],
    queryFn: () => getQaqcCaptures(projectId!, id!),
    enabled: Boolean(projectId && id),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['qaqc-record', projectId, id] });
    queryClient.invalidateQueries({ queryKey: ['qaqc-records', projectId] });
    queryClient.invalidateQueries({ queryKey: ['qaqc-summary', projectId] });
  }

  // Step 1: respond -- open/reopened -> pending_confirmation. Does NOT
  // close the record; see confirmMutation below for the step that does.
  const respondMutation = useMutation({
    mutationFn: () => respondToQaqcRecord(projectId!, id!, responseDraft.trim()),
    onSuccess: () => {
      setResponseDraft('');
      invalidateAll();
    },
  });

  // Step 2: confirm -- QAQC-in-charge only. 'confirmed' -> closed
  // (terminal). 'rejected' -> reopened (comment required).
  const confirmMutation = useMutation({
    mutationFn: (decision: 'confirmed' | 'rejected') => confirmQaqcRecord(projectId!, id!, decision, confirmComment.trim() || undefined),
    onSuccess: () => {
      setConfirmComment('');
      setRejecting(false);
      invalidateAll();
    },
  });

  async function handleDownloadPdf() {
    if (!record) return;
    setDownloadError('');
    setDownloading(true);
    try {
      await apiDownload(`/projects/${projectId}/qaqc/${id}/pdf`, `${record.recordNumber ?? record.id}.pdf`);
    } catch (err) {
      setDownloadError(apiErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  if (!projectId || !recordType || !id) return null;

  const record = recordQuery.data;
  const shortLabel = QAQC_RECORD_TYPE_SHORT_LABELS[recordType];

  if (recordQuery.isLoading) {
    return (
      <>
        <PageHeader eyebrow={projectQuery.data?.name ?? 'Project'} title={shortLabel} />
        <div className="p-6 text-sm text-ink-500">Loading…</div>
      </>
    );
  }

  if (!record) {
    return (
      <>
        <PageHeader eyebrow={projectQuery.data?.name ?? 'Project'} title={shortLabel} />
        <div className="p-6 text-sm text-danger">{shortLabel} not found.</div>
      </>
    );
  }

  // Client-side visual gating only -- QaqcService's per-type role check
  // (ISSUE_ROLES_BY_TYPE/RESPOND_ROLES_BY_TYPE) is the real enforcement.
  // NCR/SOR and WIR/MIR swap issuer/responder roles -- construction
  // responds to NCR/SOR, QAQC responds to WIR/MIR (a WIR/MIR is the
  // construction team's own inspection request) -- so this keys off the
  // record's own recordType, not a fixed list. Confirm never swaps:
  // QAQC-in-charge confirms every type, a deliberately narrower gate than
  // respond -- the whole point of the two-step close.
  const canRespond = Boolean(
    (record.status === 'open' || record.status === 'reopened') &&
    currentUser?.companyRole && QAQC_RESPOND_ROLES_BY_TYPE[record.recordType].includes(currentUser.companyRole),
  );
  const canConfirm = Boolean(
    record.status === 'pending_confirmation' &&
    currentUser?.companyRole && (QAQC_CONFIRM_ROLES as readonly string[]).includes(currentUser.companyRole),
  );
  // Attaching a missed photo/document is a narrower ask than editing the
  // record's substantive fields, and the backend never gated addAttachment/
  // linkCapture on status in the first place -- these two stay role-only
  // (never status-gated) so the issuer/responder can still attach evidence
  // they forgot, even after the record moved on (including past closed).
  // The confirm step itself, and the response/description text, stay
  // exactly as status-gated as before -- only "attach what I forgot" opens up.
  const canUploadIssueEvidence = Boolean(
    currentUser?.companyRole && QAQC_ISSUE_ROLES_BY_TYPE[record.recordType].includes(currentUser.companyRole),
  );
  const canUploadResponseEvidence = Boolean(
    currentUser?.companyRole && QAQC_RESPOND_ROLES_BY_TYPE[record.recordType].includes(currentUser.companyRole),
  );

  const issueAttachments = (attachmentsQuery.data ?? []).filter((a) => (a.kind ?? 'issue') === 'issue');
  const responseAttachments = (attachmentsQuery.data ?? []).filter((a) => a.kind === 'response');
  const issueCaptures = (capturesQuery.data ?? []).filter((c) => (c.kind ?? 'issue') === 'issue');
  const responseCaptures = (capturesQuery.data ?? []).filter((c) => c.kind === 'response');

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title={record.recordNumber ?? shortLabel}
        actions={
          <Link to={`/projects/${projectId}/qaqc/${recordType}`} className="btn-ghost !px-2 !py-2 text-xs">
            Back to {shortLabel}s
          </Link>
        }
      />

      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-2">{record.subject}</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge tone={QAQC_STATUS_TONE[record.status]} label={QAQC_STATUS_LABELS[record.status]} />
            <StatusBadge tone={QAQC_PRIORITY_TONE[record.priority]} label={QAQC_PRIORITY_LABELS[record.priority]} />
            {record.discipline && (
              <span className="badge bg-base-700 text-ink-500">
                {RFI_DISCIPLINE_LABELS[record.discipline]}
                {record.discipline === 'other' && record.disciplineOther ? ` (${record.disciplineOther})` : ''}
              </span>
            )}
          </div>
          {record.status === 'closed' && record.confirmedAt && (
            <p className="text-xs text-ink-500 mt-2">
              Confirmed closed by {record.confirmedByName ?? 'Unknown'} on {formatDateTime(record.confirmedAt)}
            </p>
          )}
          {record.status === 'reopened' && (
            <p className="text-xs text-warn mt-2">
              Reopened by QAQC{record.confirmationComment ? `: ${record.confirmationComment}` : ''}
            </p>
          )}
          {record.status === 'pending_confirmation' && record.respondedAt && (
            <p className="text-xs text-ink-500 mt-2">
              Responded by {record.respondedByName ?? 'Unknown'} on {formatDateTime(record.respondedAt)}, awaiting QAQC confirmation
            </p>
          )}
        </div>

        <section className="panel tick-frame p-6">
          <div className="field-label mb-4">{shortLabel} Information</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
            <InfoRow label="Number" value={record.recordNumber ?? '—'} mono />
            <InfoRow label="Issued by" value={record.issuedByName ?? '—'} />
            <InfoRow label="Assigned to" value={record.assignedToName ?? 'Unassigned'} />
            <InfoRow label="Due date" value={formatDate(record.dueDate)} />
            <InfoRow label="Location" value={record.locationName ?? '—'} />
            <InfoRow label="Created" value={formatDateTime(record.createdAt)} />
          </div>
        </section>

        {/* Description + issue-time evidence. The two attachment affordances
            are primarily filled in on the create form (§4), but stay open
            here too (role-gated, not status-gated) so the issuer can still
            attach something they forgot -- even after the record closed. */}
        <section className="panel tick-frame p-6 space-y-4">
          <div className="field-label">Description</div>
          <p className="text-sm text-ink-100 whitespace-pre-wrap">{record.description}</p>
          <CaptureSection projectId={projectId} qaqcId={id} kind="issue" captures={issueCaptures} canUpload={canUploadIssueEvidence} onChanged={() => queryClient.invalidateQueries({ queryKey: ['qaqc-captures', projectId, id] })} />
          <AttachmentSection
            projectId={projectId}
            qaqcId={id}
            kind="issue"
            attachments={issueAttachments}
            canUpload={canUploadIssueEvidence}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ['qaqc-attachments', projectId, id] })}
          />
        </section>

        {/* Response -- step 1 of the two-step close. Both attachment
            affordances again here, writing kind: 'response', exactly
            mirroring RFI's query-time/response-time attachment split. */}
        <section className="panel tick-frame p-6 space-y-4">
          <div className="field-label">Response</div>
          {record.response && (
            <p className="text-sm text-ink-100 whitespace-pre-wrap">{record.response}</p>
          )}
          {canRespond && (
            <>
              <textarea
                className="field-input min-h-[96px]"
                placeholder={record.status === 'reopened' ? 'Write a new response…' : 'Write the response…'}
                value={responseDraft}
                onChange={(e) => setResponseDraft(e.target.value)}
              />
              {respondMutation.isError && <p className="field-error">{apiErrorMessage(respondMutation.error)}</p>}
              <button
                onClick={() => respondMutation.mutate()}
                disabled={!responseDraft.trim() || respondMutation.isPending}
                className="btn-primary !px-4 !py-2 text-xs"
              >
                {respondMutation.isPending ? 'Submitting…' : 'Submit response'}
              </button>
            </>
          )}
          {!record.response && !canRespond && (
            <p className="text-sm text-ink-500">No response yet.</p>
          )}

          <CaptureSection
            projectId={projectId}
            qaqcId={id}
            kind="response"
            captures={responseCaptures}
            canUpload={canUploadResponseEvidence}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ['qaqc-captures', projectId, id] })}
          />
          <AttachmentSection
            projectId={projectId}
            qaqcId={id}
            kind="response"
            attachments={responseAttachments}
            canUpload={canUploadResponseEvidence}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ['qaqc-attachments', projectId, id] })}
          />
        </section>

        {/* QAQC Confirmation -- step 2, deliberately separate section with
            its own, narrower role gate. No attachment affordance of its
            own (§4) -- just the confirm/reject decision and comment. */}
        {(canConfirm || record.status === 'pending_confirmation') && (
          <section className="panel tick-frame p-6 space-y-4">
            <div className="field-label">QAQC Confirmation</div>
            {canConfirm ? (
              <>
                <p className="text-xs text-ink-500">
                  Confirm that the response above resolves this {shortLabel}, or reject it and send it back for another response.
                </p>
                {rejecting && (
                  <textarea
                    className="field-input min-h-[72px]"
                    placeholder="Reason for rejecting (required)…"
                    value={confirmComment}
                    onChange={(e) => setConfirmComment(e.target.value)}
                  />
                )}
                {confirmMutation.isError && <p className="field-error">{apiErrorMessage(confirmMutation.error)}</p>}
                <div className="flex gap-2">
                  {!rejecting && (
                    <>
                      <button
                        onClick={() => confirmMutation.mutate('confirmed')}
                        disabled={confirmMutation.isPending}
                        className="btn-primary !px-4 !py-2 text-xs"
                      >
                        {confirmMutation.isPending ? 'Confirming…' : `Confirm & close ${shortLabel}`}
                      </button>
                      <button onClick={() => setRejecting(true)} className="btn-secondary !px-4 !py-2 text-xs">
                        Reject
                      </button>
                    </>
                  )}
                  {rejecting && (
                    <>
                      <button
                        onClick={() => confirmMutation.mutate('rejected')}
                        disabled={!confirmComment.trim() || confirmMutation.isPending}
                        className="btn-primary !px-4 !py-2 text-xs"
                      >
                        {confirmMutation.isPending ? 'Sending back…' : 'Send back (reopen)'}
                      </button>
                      <button onClick={() => { setRejecting(false); setConfirmComment(''); }} className="btn-ghost !px-2 !py-2 text-xs">
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-500">Awaiting confirmation from QAQC.</p>
            )}
          </section>
        )}

        {/* Human Risk Assessment -- only NCR feeds the Risk Engine (see
            risk.service.ts's RISK_WORTHY_NODE_TYPES); SOR/WIR/MIR never get
            a Risk at all, so this section doesn't apply to them. Lets
            whoever's looking at this NCR set/override the Probability x
            Impact assessment directly, same widget already embedded on
            Issue/RFI/Snag/Submittal detail pages. */}
        {record.recordType === 'ncr' && (
          <section className="panel tick-frame p-6">
            <InlineRiskAssessment projectId={projectId} nodeType="ncr" entityId={id} />
          </section>
        )}

        {downloadError && <p className="field-error">{downloadError}</p>}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-base-600">
          <button onClick={handleDownloadPdf} disabled={downloading} className="btn-secondary !px-4 !py-2 text-xs ml-auto">
            {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`text-ink-100 font-medium ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}

// "+ Add document" -- generic typed attachment affordance. Distinct from
// CaptureSection below (the "+ Add photo" affordance) -- per the brief's
// §4, these are two different, already-established patterns in this app,
// not one generic uploader.
function AttachmentSection({
  projectId, qaqcId, kind, attachments, canUpload, onChanged,
}: {
  projectId: string;
  qaqcId: string;
  kind: QaqcAttachmentKind;
  attachments: QaqcAttachment[];
  canUpload: boolean;
  onChanged: () => void;
}) {
  const [documentType, setDocumentType] = useState<RfiDocumentType>('other');

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadQaqcAttachment(projectId, qaqcId, file, { kind, documentType }),
    onSuccess: onChanged,
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteQaqcAttachment(projectId, qaqcId, attachmentId),
    onSuccess: onChanged,
  });

  return (
    <div>
      <div className="field-label mb-2">{kind === 'issue' ? 'Issue documents' : 'Response documents'}</div>
      {attachments.length === 0 && <p className="text-xs text-ink-500 mb-2">No documents attached yet.</p>}
      {attachments.length > 0 && (
        <div className="overflow-x-auto mb-2" tabIndex={0}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-500 border-b border-base-600">
                <th className="py-2 pr-4 font-medium">File</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Uploaded by</th>
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {attachments.map((a) => (
                <tr key={a.id} className="border-b border-base-700/60 last:border-0">
                  <td className="py-2 pr-4">
                    {a.attachmentReadUrl ? (
                      <a href={a.attachmentReadUrl} target="_blank" rel="noreferrer" className="text-blueprint hover:text-blueprint-hover underline">
                        {a.filename}
                      </a>
                    ) : (
                      <span className="text-ink-300">{a.filename}</span>
                    )}
                    <span className="text-ink-500"> ({formatBytes(Number(a.sizeBytes))})</span>
                  </td>
                  <td className="py-2 pr-4 text-ink-300">{a.documentType ? RFI_DOCUMENT_TYPE_LABELS[a.documentType] : '—'}</td>
                  <td className="py-2 pr-4 text-ink-300">{a.uploadedByName ?? '—'}</td>
                  <td className="py-2 pr-4 text-ink-300">{formatDateTime(a.uploadedAt)}</td>
                  <td className="py-2 text-right">
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
          <Listbox aria-label="Document type" className="field-input w-auto !py-2 text-xs" value={documentType} onChange={(e) => setDocumentType(e.target.value as RfiDocumentType)}>
            {RFI_DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{RFI_DOCUMENT_TYPE_LABELS[t]}</option>
            ))}
          </Listbox>
          <label className="btn-secondary !px-4 !py-2 text-xs cursor-pointer inline-block">
            + Add document
            <input
              type="file"
              className="hidden"
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

// "+ Add photo" -- links an already-uploaded Capture, mirroring
// IssueFormModal's quick-photo pattern. Distinct from AttachmentSection
// above.
function CaptureSection({
  projectId, qaqcId, kind, captures, canUpload, onChanged,
}: {
  projectId: string;
  qaqcId: string;
  kind: QaqcAttachmentKind;
  captures: QaqcLinkedCapture[];
  canUpload: boolean;
  onChanged: () => void;
}) {
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const capture = await uploadCapture(projectId, file, { captureType: 'photo_standard' });
      return linkQaqcCapture(projectId, qaqcId, capture.id, kind);
    },
    onSuccess: onChanged,
  });

  return (
    <div>
      <div className="field-label mb-2">{kind === 'issue' ? 'Issue photos' : 'Response photos'}</div>
      {captures.length === 0 && <p className="text-xs text-ink-500 mb-2">No photos attached yet.</p>}
      {captures.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {captures.map((c) => (
            <div key={c.id} className="w-16 h-16 rounded overflow-hidden border border-base-600 shrink-0 bg-base-700/40 flex items-center justify-center">
              {c.thumbnailUrl ? (
                <img src={c.thumbnailUrl} alt={c.title ?? 'Photo'} className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-ink-500 px-2 text-center">{c.title ?? 'Photo'}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {uploadMutation.isError && <p className="field-error">{apiErrorMessage(uploadMutation.error)}</p>}
      {canUpload && (
        <label className="btn-secondary !px-4 !py-2 text-xs cursor-pointer inline-block">
          + Add photo
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadMutation.mutate(file);
              e.target.value = '';
            }}
          />
        </label>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
