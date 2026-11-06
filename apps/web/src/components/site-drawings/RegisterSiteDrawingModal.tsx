import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Alert } from '../ui/Alert';
import { apiErrorMessage } from '../../lib/api';
import {
  uploadSiteDrawingFile, extractSiteDrawingFields, registerSiteDrawing,
  SITE_DRAWING_WORKFLOW_STATUSES, type SiteDrawingWorkflowStatus,
} from '../../lib/site-drawings.api';
import { WORKFLOW_STATUS_LABELS } from './siteDrawingDisplay';
import { Listbox } from '../ui/Listbox';

// Registers a brand-new drawing from the Local source (brief section 6;
// the only source this phase has real, credential-free access to). The
// uploader picks the canonical workflow status directly, since there's no
// external source status to map yet for an internal upload (never inferred
// from the filename, per section 5).
//
// The dropped file is uploaded immediately (not deferred to submit) and
// run through the same embedded-text/OCR extraction the bulk import
// pipeline uses, so the fields below arrive pre-filled instead of typed
// from a blank form -- exactly what a confident extraction already gives
// a bulk import, just for one file. Extraction never invents a value with
// nothing to back it: a field stays blank, for manual entry, when nothing
// could be confidently read.
export function RegisterSiteDrawingModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [extractState, setExtractState] = useState<'idle' | 'working' | 'confident' | 'uncertain' | 'none' | 'error'>('idle');
  const [drawingNumber, setDrawingNumber] = useState('');
  const [drawingTitle, setDrawingTitle] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [buildingOrZone, setBuildingOrZone] = useState('');
  const [floorOrLevel, setFloorOrLevel] = useState('');
  const [originator, setOriginator] = useState('');
  const [responsibleSubcontractor, setResponsibleSubcontractor] = useState('');
  const [revisionNumber, setRevisionNumber] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState<SiteDrawingWorkflowStatus>('UNDER_REVIEW');
  const [issueDate, setIssueDate] = useState('');

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    setFile(f);
    setDrawingTitle(f.name.replace(/\.pdf$/i, ''));
    setExtractState('working');

    void (async () => {
      try {
        const { storageKey: key } = await uploadSiteDrawingFile(projectId, f);
        setStorageKey(key);
        const fields = await extractSiteDrawingFields(projectId, key);
        if (!fields) {
          setExtractState('none');
          return;
        }
        if (fields.drawingNumber) setDrawingNumber(fields.drawingNumber);
        if (fields.drawingTitle) setDrawingTitle(fields.drawingTitle);
        if (fields.revisionNumber) setRevisionNumber(fields.revisionNumber);
        if (fields.discipline) setDiscipline(fields.discipline);
        if (fields.issueDate) setIssueDate(fields.issueDate);
        setExtractState(fields.confidence >= 0.7 ? 'confident' : 'uncertain');
      } catch {
        // Upload/extraction failure here is never fatal to registration --
        // the form just falls back to fully manual entry, same as before
        // this existed.
        setExtractState('error');
      }
    })();
  }, [projectId]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1 });

  function reset() {
    setFile(null); setStorageKey(null); setExtractState('idle');
    setDrawingNumber(''); setDrawingTitle(''); setDiscipline(''); setBuildingOrZone('');
    setFloorOrLevel(''); setOriginator(''); setResponsibleSubcontractor('');
    setRevisionNumber(''); setWorkflowStatus('UNDER_REVIEW'); setIssueDate('');
  }

  const mutation = useMutation({
    mutationFn: () =>
      registerSiteDrawing(projectId, {
        drawingNumber, drawingTitle, discipline: discipline || undefined, buildingOrZone: buildingOrZone || undefined,
        floorOrLevel: floorOrLevel || undefined,
        // Left undefined (not empty string) when blank, so the backend
        // resolves it from the project's own org mapping (master spec
        // section 4) instead of overwriting a real mapping match with "".
        originator: originator || undefined, responsibleSubcontractor: responsibleSubcontractor || undefined,
        revisionNumber, workflowStatus, issueDate: issueDate || undefined,
        storageKey: storageKey!,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-drawings', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawing-filter-options', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawing-dashboard-stats', projectId] });
      reset();
      onClose();
    },
  });

  const canSubmit = Boolean(
    file && storageKey && extractState !== 'working' && drawingNumber.trim() && drawingTitle.trim() && revisionNumber.trim(),
  );

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

        {extractState === 'working' && <p className="text-sm text-ink-300">{storageKey ? 'Reading the drawing…' : 'Uploading…'}</p>}
        {extractState === 'confident' && <Alert tone="success">Fields auto-filled from the drawing. Check them before registering.</Alert>}
        {extractState === 'uncertain' && <Alert tone="warning">Some fields were auto-filled, but the reading wasn't confident — check them carefully.</Alert>}
        {extractState === 'none' && <Alert tone="info">Couldn't read this drawing automatically. Fill in the fields below.</Alert>}
        {extractState === 'error' && <Alert tone="info">Auto-fill failed. Fill in the fields below manually.</Alert>}

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
            <label className="field-label" htmlFor="sd-originator">Originator</label>
            <input id="sd-originator" className="field-input" value={originator} onChange={(e) => setOriginator(e.target.value)} placeholder="Leave blank to use the drawing number's mapping" />
          </div>
          <div>
            <label className="field-label" htmlFor="sd-subcontractor">Responsible subcontractor</label>
            <input id="sd-subcontractor" className="field-input" value={responsibleSubcontractor} onChange={(e) => setResponsibleSubcontractor(e.target.value)} placeholder="Leave blank to use the drawing number's mapping" />
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
            <p className="text-xs text-ink-500 mt-2">Set this deliberately. Never inferred from the filename or upload date.</p>
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
