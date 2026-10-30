import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { apiErrorMessage } from '../../lib/api';
import { uploadAndRegisterSiteDrawing, SITE_DRAWING_WORKFLOW_STATUSES, type SiteDrawingWorkflowStatus } from '../../lib/site-drawings.api';
import { WORKFLOW_STATUS_LABELS } from './siteDrawingDisplay';
import { Listbox } from '../ui/Listbox';

// Registers a brand-new drawing from the Local source (brief section 6 --
// the only source this phase has real, credential-free access to). The
// uploader picks the canonical workflow status directly, since there's no
// external source status to map yet for an internal upload (never inferred
// from the filename, per section 5).
export function RegisterSiteDrawingModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [drawingNumber, setDrawingNumber] = useState('');
  const [drawingTitle, setDrawingTitle] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [buildingOrZone, setBuildingOrZone] = useState('');
  const [floorOrLevel, setFloorOrLevel] = useState('');
  const [revisionNumber, setRevisionNumber] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState<SiteDrawingWorkflowStatus>('UNDER_REVIEW');
  const [issueDate, setIssueDate] = useState('');

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (f) {
      setFile(f);
      if (!drawingTitle) setDrawingTitle(f.name.replace(/\.pdf$/i, ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingTitle]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1 });

  function reset() {
    setFile(null); setDrawingNumber(''); setDrawingTitle(''); setDiscipline(''); setBuildingOrZone('');
    setFloorOrLevel(''); setRevisionNumber(''); setWorkflowStatus('UNDER_REVIEW'); setIssueDate('');
  }

  const mutation = useMutation({
    mutationFn: () =>
      uploadAndRegisterSiteDrawing(projectId, file!, {
        drawingNumber, drawingTitle, discipline: discipline || undefined, buildingOrZone: buildingOrZone || undefined,
        floorOrLevel: floorOrLevel || undefined, revisionNumber, workflowStatus, issueDate: issueDate || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-drawings', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawing-filter-options', projectId] });
      reset();
      onClose();
    },
  });

  const canSubmit = Boolean(file && drawingNumber.trim() && drawingTitle.trim() && revisionNumber.trim());

  return (
    <Modal open={open} onClose={onClose} title="Register a drawing" wide>
      <div className="space-y-4">
        <div
          {...getRootProps()}
          className={`rounded border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-signal bg-signal/5' : 'border-base-600 hover:border-base-500'
          }`}
        >
          <input {...getInputProps()} />
          {file ? <p className="text-sm text-ink-100">{file.name}</p> : (
            <>
              <p className="text-sm text-ink-300">Drag a PDF here, or click to browse</p>
              <p className="text-xs text-ink-500 mt-2">PDF only, up to 200 MB</p>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label" htmlFor="sd-number">Drawing number</label>
            <input id="sd-number" className="field-input" value={drawingNumber} onChange={(e) => setDrawingNumber(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="sd-revision">Revision</label>
            <input id="sd-revision" className="field-input" value={revisionNumber} onChange={(e) => setRevisionNumber(e.target.value)} placeholder="e.g. C" />
          </div>
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="sd-title">Title</label>
            <input id="sd-title" className="field-input" value={drawingTitle} onChange={(e) => setDrawingTitle(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="sd-discipline">Discipline</label>
            <input id="sd-discipline" className="field-input" value={discipline} onChange={(e) => setDiscipline(e.target.value)} placeholder="e.g. Structural" />
          </div>
          <div>
            <label className="field-label" htmlFor="sd-building">Building / zone</label>
            <input id="sd-building" className="field-input" value={buildingOrZone} onChange={(e) => setBuildingOrZone(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="sd-floor">Floor / level</label>
            <input id="sd-floor" className="field-input" value={floorOrLevel} onChange={(e) => setFloorOrLevel(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="sd-issue-date">Issue date</label>
            <input id="sd-issue-date" type="date" className="field-input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="sd-status">Workflow status</label>
            <Listbox id="sd-status" className="field-input" value={workflowStatus} onChange={(e) => setWorkflowStatus(e.target.value as SiteDrawingWorkflowStatus)}>
              {SITE_DRAWING_WORKFLOW_STATUSES.map((s) => <option key={s} value={s}>{WORKFLOW_STATUS_LABELS[s]}</option>)}
            </Listbox>
            <p className="text-xs text-ink-500 mt-2">Set this deliberately — never inferred from the filename or upload date.</p>
          </div>
        </div>

        {mutation.isError && <p className="field-error">{apiErrorMessage(mutation.error)}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Registering…' : 'Register drawing'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
