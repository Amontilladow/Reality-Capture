import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { apiErrorMessage } from '../../lib/api';
import { uploadAndAddSiteDrawingRevision, SITE_DRAWING_WORKFLOW_STATUSES, type SiteDrawingWorkflowStatus } from '../../lib/site-drawings.api';
import { WORKFLOW_STATUS_LABELS } from './siteDrawingDisplay';
import { Listbox } from '../ui/Listbox';

// The previous current revision is automatically marked superseded server-
// side the moment this one is registered (SiteDrawingsService.addRevision)
// -- it stays in the register, clearly labeled, never deleted (brief
// section 5).
export function AddRevisionModal({ open, onClose, projectId, drawingId, drawingTitle }: {
  open: boolean; onClose: () => void; projectId: string; drawingId: string; drawingTitle: string;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [revisionNumber, setRevisionNumber] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState<SiteDrawingWorkflowStatus>('UNDER_REVIEW');
  const [issueDate, setIssueDate] = useState('');

  const onDrop = useCallback((accepted: File[]) => { if (accepted[0]) setFile(accepted[0]); }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1 });

  const mutation = useMutation({
    mutationFn: () => uploadAndAddSiteDrawingRevision(projectId, drawingId, file!, { revisionNumber, workflowStatus, issueDate: issueDate || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-drawings', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawing', projectId, drawingId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawing-revisions', projectId, drawingId] });
      setFile(null); setRevisionNumber(''); setWorkflowStatus('UNDER_REVIEW'); setIssueDate('');
      onClose();
    },
  });

  const canSubmit = Boolean(file && revisionNumber.trim());

  return (
    <Modal open={open} onClose={onClose} title={`Add revision — ${drawingTitle}`}>
      <div className="space-y-4">
        <div
          {...getRootProps()}
          className={`rounded border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-signal bg-signal/5' : 'border-base-600 hover:border-base-500'
          }`}
        >
          <input {...getInputProps()} />
          {file ? <p className="text-sm text-ink-100">{file.name}</p> : <p className="text-sm text-ink-300">Drag the new revision's PDF here, or click to browse</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label" htmlFor="rev-number">Revision</label>
            <input id="rev-number" className="field-input" value={revisionNumber} onChange={(e) => setRevisionNumber(e.target.value)} placeholder="e.g. D" />
          </div>
          <div>
            <label className="field-label" htmlFor="rev-issue-date">Issue date</label>
            <input id="rev-issue-date" type="date" className="field-input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="rev-status">Workflow status</label>
            <Listbox id="rev-status" className="field-input" value={workflowStatus} onChange={(e) => setWorkflowStatus(e.target.value as SiteDrawingWorkflowStatus)}>
              {SITE_DRAWING_WORKFLOW_STATUSES.map((s) => <option key={s} value={s}>{WORKFLOW_STATUS_LABELS[s]}</option>)}
            </Listbox>
          </div>
        </div>
        {mutation.isError && <p className="field-error">{apiErrorMessage(mutation.error)}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Uploading…' : 'Add revision'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
