import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RFI_DISCIPLINE_LABELS } from '@engineeringos/types';
import { PageHeader } from '../components/layout/PageHeader';
import {
  getQaqcRecord, closeQaqcRecord, getQaqcAttachments, uploadQaqcAttachment, deleteQaqcAttachment,
  type QaqcAttachment, type QaqcAttachmentKind, type QaqcRecordType,
} from '../lib/qaqc.api';
import { getProject } from '../lib/projects.api';
import {
  QAQC_STATUS_LABELS, QAQC_PRIORITY_LABELS, QAQC_RECORD_TYPE_SHORT_LABELS, QAQC_CLOSE_ROLES,
  QAQC_STATUS_TONE, QAQC_PRIORITY_TONE, formatDate, formatDateTime,
} from '../lib/qaqc-constants';
import { StatusBadge } from '../components/ui/Badge';
import { apiErrorMessage, apiDownload } from '../lib/api';
import { useAuthStore } from '../store/auth.store';

export default function QaqcDetailPage() {
  const { projectId, recordType, id } = useParams<{ projectId: string; recordType: QaqcRecordType; id: string }>();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [response, setResponse] = useState('');
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

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['qaqc-record', projectId, id] });
    queryClient.invalidateQueries({ queryKey: ['qaqc-records', projectId] });
    queryClient.invalidateQueries({ queryKey: ['qaqc-summary', projectId] });
  }

  const closeMutation = useMutation({
    mutationFn: () => closeQaqcRecord(projectId!, id!, response.trim()),
    onSuccess: invalidateAll,
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

  // Client-side visual gating only -- @RequireExactRoles(...CLOSE_ROLES) on
  // the backend (qaqc.controller.ts) is the real enforcement. The original
  // issuer can also close (§7 scenario 2's "the original qa_qc_manager
  // issuer can also close"), which already falls out of qa_qc_manager
  // being a CLOSE_ROLES member whenever the issuer holds that role; if the
  // issuer is a different role entirely the server still allows it via
  // issuedBy -- not modeled client-side, so canClose is a conservative
  // under-estimate for that one edge case (button stays hidden, action
  // would still succeed if attempted via the API).
  const canClose = Boolean(
    record.status !== 'closed' && record.status !== 'void' &&
    currentUser?.companyRole && (QAQC_CLOSE_ROLES as readonly string[]).includes(currentUser.companyRole),
  );
  const canUploadResponse = canClose;

  const issueAttachments = (attachmentsQuery.data ?? []).filter((a) => (a.kind ?? 'issue') === 'issue');
  const responseAttachments = (attachmentsQuery.data ?? []).filter((a) => a.kind === 'response');

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title={record.recordNumber ?? shortLabel}
        actions={
          <Link to={`/projects/${projectId}/qaqc/${recordType}`} className="btn-ghost !px-2 !py-1 text-xs">
            ← Back to {shortLabel}s
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
                {record.discipline === 'other' && record.disciplineOther ? ` — ${record.disciplineOther}` : ''}
              </span>
            )}
          </div>
          {record.status === 'closed' && record.closedAt && (
            <p className="text-xs text-ink-500 mt-1">
              Closed by {record.closedByName ?? 'Unknown'} on {formatDateTime(record.closedAt)}
            </p>
          )}
        </div>

        <section className="panel tick-frame p-5">
          <div className="field-label mb-3">{shortLabel} Information</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <InfoRow label="Number" value={record.recordNumber ?? '—'} mono />
            <InfoRow label="Issued by" value={record.issuedByName ?? '—'} />
            <InfoRow label="Assigned to" value={record.assignedToName ?? 'Unassigned'} />
            <InfoRow label="Due date" value={formatDate(record.dueDate)} />
            <InfoRow label="Location" value={record.locationName ?? '—'} />
            <InfoRow label="Created" value={formatDateTime(record.createdAt)} />
          </div>
        </section>

        <section className="panel tick-frame p-5 space-y-3">
          <div className="field-label">Description</div>
          <p className="text-sm text-ink-100 whitespace-pre-wrap">{record.description}</p>
          <AttachmentSection
            projectId={projectId}
            qaqcId={id}
            kind="issue"
            attachments={issueAttachments}
            canUpload={false}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ['qaqc-attachments', projectId, id] })}
          />
        </section>

        <section className="panel tick-frame p-5 space-y-3">
          <div className="field-label">Response</div>
          {record.response ? (
            <p className="text-sm text-ink-100 whitespace-pre-wrap">{record.response}</p>
          ) : canClose ? (
            <textarea
              className="field-input min-h-[96px]"
              placeholder="Write the response…"
              value={response}
              onChange={(e) => setResponse(e.target.value)}
            />
          ) : (
            <p className="text-sm text-ink-500">No response yet.</p>
          )}
          {closeMutation.isError && <p className="field-error">{apiErrorMessage(closeMutation.error)}</p>}

          <AttachmentSection
            projectId={projectId}
            qaqcId={id}
            kind="response"
            attachments={responseAttachments}
            canUpload={canUploadResponse}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ['qaqc-attachments', projectId, id] })}
          />
        </section>

        {downloadError && <p className="field-error">{downloadError}</p>}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-base-600">
          {canClose && (
            <button
              onClick={() => closeMutation.mutate()}
              disabled={!response.trim() || closeMutation.isPending}
              className="btn-primary !px-3 !py-1.5 text-xs"
            >
              {closeMutation.isPending ? 'Closing…' : `Close ${shortLabel}`}
            </button>
          )}
          <button onClick={handleDownloadPdf} disabled={downloading} className="btn-secondary !px-3 !py-1.5 text-xs ml-auto">
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
  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadQaqcAttachment(projectId, qaqcId, file, kind),
    onSuccess: onChanged,
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteQaqcAttachment(projectId, qaqcId, attachmentId),
    onSuccess: onChanged,
  });

  return (
    <div>
      <div className="field-label mb-1.5">{kind === 'issue' ? 'Issue attachments' : 'Response attachments'}</div>
      {attachments.length === 0 && <p className="text-xs text-ink-500 mb-2">No files attached yet.</p>}
      {attachments.length > 0 && (
        <div className="overflow-x-auto mb-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-500 border-b border-base-600">
                <th className="py-1.5 pr-3 font-medium">File</th>
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
        <label className="btn-secondary !px-3 !py-1.5 text-xs cursor-pointer inline-block">
          Upload file
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
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
