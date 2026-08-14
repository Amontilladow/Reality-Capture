import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RFI_DISCIPLINE_LABELS } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { updateRfi, deleteRfi, getRfiAttachments, uploadRfiAttachment, deleteRfiAttachment, type RfiListItem } from '../lib/rfis.api';
import { getProject } from '../lib/projects.api';
import { downloadRfiXls } from '../lib/rfi-xls';
import { RFI_STATUS_LABELS, RFI_STATUS_BADGE_CLASS, RFI_PRIORITY_LABELS, RFI_PRIORITY_BADGE_CLASS, formatDate } from '../lib/rfi-constants';
import { apiErrorMessage, apiDownload } from '../lib/api';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12.5l-8.5 8.5a4 4 0 01-5.7-5.7L15.3 6.8a2.7 2.7 0 013.8 3.8L10.6 19a1.3 1.3 0 01-1.9-1.9l7.5-7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RfiDetailModal({
  open, onClose, projectId, rfi,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  rfi: RfiListItem | null;
}) {
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState('');

  useEffect(() => {
    setAnswer(rfi?.answer ?? '');
  }, [rfi]);

  const answerMutation = useMutation({
    mutationFn: () => updateRfi(projectId, rfi!.id, { answer: answer.trim(), status: 'answered' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
      queryClient.invalidateQueries({ queryKey: ['rfi-summary', projectId] });
      onClose();
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateRfi(projectId, rfi!.id, { status: status as never }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
      queryClient.invalidateQueries({ queryKey: ['rfi-summary', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRfi(projectId, rfi!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
      queryClient.invalidateQueries({ queryKey: ['rfi-summary', projectId] });
      onClose();
    },
  });

  const attachmentsQuery = useQuery({
    queryKey: ['rfi-attachments', projectId, rfi?.id],
    queryFn: () => getRfiAttachments(projectId, rfi!.id),
    enabled: open && Boolean(rfi),
  });

  const attachMutation = useMutation({
    mutationFn: (file: File) => uploadRfiAttachment(projectId, rfi!.id, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rfi-attachments', projectId, rfi?.id] }),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteRfiAttachment(projectId, rfi!.id, attachmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rfi-attachments', projectId, rfi?.id] }),
  });

  // Same ['project', projectId] key ProjectDetail.tsx/EditProjectModal.tsx
  // already use -- opening an RFI from within its own project is very
  // likely a cache hit, not a new request.
  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
    enabled: open,
  });

  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  async function handleDownload() {
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
      const warnings = await downloadRfiXls(rfi, projectQuery.data);
      if (warnings.length > 0) setXlsWarning(warnings.join(' '));
    } catch (err) {
      setXlsError(apiErrorMessage(err));
    } finally {
      setXlsDownloading(false);
    }
  }

  if (!rfi) return null;

  return (
    <Modal open={open} onClose={onClose} title={rfi.rfiNumber ?? 'RFI'} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${RFI_STATUS_BADGE_CLASS[rfi.status]}`}>{RFI_STATUS_LABELS[rfi.status]}</span>
          <span className={`badge ${RFI_PRIORITY_BADGE_CLASS[rfi.priority]}`}>{RFI_PRIORITY_LABELS[rfi.priority]}</span>
          {rfi.discipline && (
            <span className="badge bg-base-700 text-ink-500">
              {RFI_DISCIPLINE_LABELS[rfi.discipline]}
              {rfi.discipline === 'other' && rfi.disciplineOther ? ` — ${rfi.disciplineOther}` : ''}
            </span>
          )}
          {rfi.costImpact && <span className="badge bg-warn/15 text-warn">Cost impact</span>}
          {rfi.timeImpact && <span className="badge bg-warn/15 text-warn">Time impact</span>}
          <span className="text-xs text-ink-500 ml-auto">Due {formatDate(rfi.dueDate)}</span>
        </div>

        <h3 className="text-base font-semibold">{rfi.subject}</h3>

        <div>
          <div className="field-label">Question</div>
          <p className="text-sm text-ink-300 whitespace-pre-wrap">{rfi.question}</p>
        </div>

        <div className="text-xs text-ink-500 flex gap-4">
          <span>Raised by {rfi.createdByName ?? '—'}</span>
          <span>Assigned to {rfi.assignedToName ?? 'Unassigned'}</span>
        </div>

        <div>
          <div className="field-label mb-1.5">Attachments</div>
          <p className="text-xs text-ink-500 mb-2">
            Drawings, photos, calculation sheets — kept alongside the RFI, not merged into the exported PDF.
          </p>
          <div className="space-y-1.5 mb-2">
            {(attachmentsQuery.data ?? []).map((a) => (
              <div key={a.id} className="flex items-center gap-1.5 text-xs bg-base-700/40 rounded px-2 py-1.5">
                {a.attachmentReadUrl ? (
                  <a
                    href={a.attachmentReadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-blueprint hover:text-blueprint-hover flex-1 min-w-0"
                  >
                    <PaperclipIcon />
                    <span className="underline truncate">{a.filename}</span>
                    <span className="text-ink-500 shrink-0">({formatBytes(Number(a.sizeBytes))})</span>
                  </a>
                ) : (
                  <div className="flex items-center gap-1.5 text-ink-300 flex-1 min-w-0">
                    <PaperclipIcon />
                    <span className="truncate">{a.filename}</span>
                    <span className="text-ink-500 shrink-0">({formatBytes(Number(a.sizeBytes))})</span>
                  </div>
                )}
                <button
                  onClick={() => deleteAttachmentMutation.mutate(a.id)}
                  disabled={deleteAttachmentMutation.isPending}
                  className="text-danger hover:text-danger/80 shrink-0"
                  title="Remove attachment"
                >
                  ✕
                </button>
              </div>
            ))}
            {attachmentsQuery.isSuccess && attachmentsQuery.data?.length === 0 && (
              <p className="text-xs text-ink-500">No files attached yet.</p>
            )}
          </div>
          {attachMutation.isError && <p className="field-error">{apiErrorMessage(attachMutation.error)}</p>}
          <label className="btn-secondary !px-3 !py-1.5 text-xs cursor-pointer inline-block">
            {attachMutation.isPending ? 'Uploading…' : '+ Attach file'}
            <input
              type="file"
              className="hidden"
              disabled={attachMutation.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) attachMutation.mutate(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        <div>
          <label className="field-label" htmlFor="answer">Answer</label>
          <textarea
            id="answer"
            className="field-input min-h-[100px]"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Write the answer to close this out…"
          />
          {answerMutation.isError && <p className="field-error">{apiErrorMessage(answerMutation.error)}</p>}
        </div>

        {downloadError && <p className="field-error">{downloadError}</p>}
        {xlsError && <p className="field-error">{xlsError}</p>}
        {xlsWarning && <p className="text-xs text-warn">{xlsWarning}</p>}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-base-600">
          <button
            onClick={() => answerMutation.mutate()}
            disabled={!answer.trim() || answerMutation.isPending}
            className="btn-primary !px-3 !py-1.5 text-xs"
          >
            {answerMutation.isPending ? 'Saving…' : 'Submit answer'}
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="btn-secondary !px-3 !py-1.5 text-xs"
          >
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
          {rfi.status !== 'closed' && (
            <button onClick={() => statusMutation.mutate('closed')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              Close RFI
            </button>
          )}
          {rfi.status === 'closed' && (
            <button onClick={() => statusMutation.mutate('open')} disabled={statusMutation.isPending} className="btn-secondary !px-3 !py-1.5 text-xs">
              ↩ Reopen
            </button>
          )}
          <button
            onClick={() => { if (confirm('Delete this RFI?')) deleteMutation.mutate(); }}
            className="btn-danger !px-3 !py-1.5 text-xs ml-auto"
          >
            Delete
          </button>
        </div>
      </div>
    </Modal>
  );
}
