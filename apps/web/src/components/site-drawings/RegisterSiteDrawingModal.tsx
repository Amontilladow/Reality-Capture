import { useCallback, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
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

// Site Drawing Hub integrity hardening, Phase 3. Upload and extraction are
// two genuinely separate steps with two separate failure modes, and this
// modal used to track only ONE combined state (extractState) for both.
// canSubmit required storageKey to be set (only true once the upload
// itself succeeds) AND extractState !== 'working' -- but the one catch
// block around BOTH steps set extractState to 'error' for either kind of
// failure, with no way to tell them apart afterward. If the UPLOAD failed,
// storageKey stayed null forever, so canSubmit stayed false forever too --
// "Register drawing" went permanently disabled, while the shown message
// ("Auto-fill failed. Fill in the fields below manually.") claimed manual
// entry was still possible. It wasn't: there was nothing uploaded to
// register. This file tracks upload and extraction as two independent,
// named phases instead, so each failure gets its own honest message and
// its own way out.
type UploadPhase = 'idle' | 'uploading' | 'uploaded' | 'upload_failed';
type ExtractPhase = 'idle' | 'working' | 'confident' | 'uncertain' | 'none' | 'error';

export function RegisterSiteDrawingModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [extractPhase, setExtractPhase] = useState<ExtractPhase>('idle');
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
  // Same silent-rejection gap as ImportDrawingsModal: a non-PDF file (a
  // .rar, a Word doc, anything) never reached onDrop's "accepted" list,
  // so the drop zone just sat on its placeholder forever with no sign
  // that anything was even tried.
  const [rejectedFileName, setRejectedFileName] = useState<string | null>(null);

  // The upload step, split out from onDrop so a failed upload can be
  // retried against the SAME File object without the user having to
  // re-drag/re-browse for it (dropzone's own UI still shows the filename
  // from the first drop either way, so retrying in place is also what
  // the UI already implies is possible).
  const runUpload = useCallback(async (f: File) => {
    setUploadPhase('uploading');
    setExtractPhase('idle');
    let key: string;
    try {
      const uploaded = await uploadSiteDrawingFile(projectId, f);
      key = uploaded.storageKey;
      setStorageKey(key);
      setUploadPhase('uploaded');
    } catch {
      setUploadPhase('upload_failed');
      return;
    }

    // Upload is done; extraction is a separate, independently-failable
    // step from here on. Nothing in this block can put canSubmit back to
    // false -- it only ever moves extractPhase, never uploadPhase/storageKey.
    setExtractPhase('working');
    try {
      const fields = await extractSiteDrawingFields(projectId, key);
      if (!fields) {
        setExtractPhase('none');
        return;
      }
      if (fields.drawingNumber) setDrawingNumber(fields.drawingNumber);
      if (fields.drawingTitle) setDrawingTitle(fields.drawingTitle);
      if (fields.revisionNumber) setRevisionNumber(fields.revisionNumber);
      if (fields.discipline) setDiscipline(fields.discipline);
      if (fields.issueDate) setIssueDate(fields.issueDate);
      setExtractPhase(fields.confidence >= 0.7 ? 'confident' : 'uncertain');
    } catch {
      // Extraction failing after a successful upload is never fatal to
      // registration -- the form just falls back to fully manual entry.
      setExtractPhase('error');
    }
  }, [projectId]);

  const onDrop = useCallback((accepted: File[], rejections: FileRejection[]) => {
    const f = accepted[0];
    if (!f) {
      const rejected = rejections[0];
      if (rejected) setRejectedFileName(rejected.file.name);
      return;
    }
    setRejectedFileName(null);
    setFile(f);
    setDrawingTitle(f.name.replace(/\.pdf$/i, ''));
    void runUpload(f);
  }, [runUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1 });

  function reset() {
    setFile(null); setStorageKey(null); setUploadPhase('idle'); setExtractPhase('idle');
    setDrawingNumber(''); setDrawingTitle(''); setDiscipline(''); setBuildingOrZone('');
    setFloorOrLevel(''); setOriginator(''); setResponsibleSubcontractor('');
    setRevisionNumber(''); setWorkflowStatus('UNDER_REVIEW'); setIssueDate(''); setRejectedFileName(null);
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

  // Upload succeeding is the ONLY precondition tied to the file itself;
  // extraction succeeding never is -- a failed/uncertain/no-match
  // extraction always falls back to manual entry, exactly as before.
  // "working" (either phase) is the only thing that blocks submission
  // beyond the required fields themselves.
  const canSubmit = Boolean(
    file && uploadPhase === 'uploaded' && extractPhase !== 'working' && drawingNumber.trim() && drawingTitle.trim() && revisionNumber.trim(),
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

        {rejectedFileName && (
          <Alert tone="danger">
            "{rejectedFileName}" isn't a supported file — only PDF is accepted here. Use the bulk import for ZIP
            packages, or a .rar/other archive needs extracting first.
          </Alert>
        )}

        {uploadPhase === 'uploading' && <p className="text-sm text-ink-300">Uploading…</p>}
        {uploadPhase === 'upload_failed' && (
          <Alert tone="danger">
            The upload failed — this file was never actually uploaded, so there's nothing yet to register.
            {' '}
            <button type="button" className="underline" onClick={() => file && void runUpload(file)}>Try again</button>
            {' or drop a different file.'}
          </Alert>
        )}

        {uploadPhase === 'uploaded' && extractPhase === 'working' && <p className="text-sm text-ink-300">Reading the drawing…</p>}
        {uploadPhase === 'uploaded' && extractPhase === 'confident' && <Alert tone="success">Fields auto-filled from the drawing. Check them before registering.</Alert>}
        {uploadPhase === 'uploaded' && extractPhase === 'uncertain' && <Alert tone="warning">Some fields were auto-filled, but the reading wasn't confident — check them carefully.</Alert>}
        {uploadPhase === 'uploaded' && extractPhase === 'none' && <Alert tone="info">Couldn't read this drawing automatically. The file uploaded fine — fill in the fields below.</Alert>}
        {uploadPhase === 'uploaded' && extractPhase === 'error' && <Alert tone="info">Auto-fill failed, but the file uploaded fine. Fill in the fields below manually.</Alert>}

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
