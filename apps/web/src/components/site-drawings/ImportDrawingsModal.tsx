import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Listbox } from '../ui/Listbox';
import { apiErrorMessage } from '../../lib/api';
import { uploadImportBatch, type DocSource, type SiteDrawingImportBatch } from '../../lib/site-drawings.api';
import { sourceProviderLabel } from './siteDrawingDisplay';

// Where a bulk-imported package actually came from (brief section 2:
// "identify its source, such as Aconex, Procore or another source"). This
// app has no live API access to Aconex/Procore -- initial ingestion is
// always a file an authorized user already downloaded and is uploading
// here -- so the source is a tag the uploader picks, never inferred.
// 'manual_link' is excluded: that source means "no file at all, just an
// external URL," which doesn't apply to an uploaded package.
const IMPORT_SOURCE_OPTIONS: DocSource[] = ['aconex', 'procore', 'sharepoint', 'bim360', 'internal'];

// A second package from the same real-world source only links up as new
// revisions of the first package's drawings (DrawingsImportProcessor keys
// each drawing on project + source + drawing number) if this selector
// matches across both uploads. Remembering the last choice per project
// avoids the easy-to-miss trap of this defaulting back to 'aconex' on
// every reopen -- including right after a successful import, exactly when
// someone is about to upload the next package from that same source.
function lastUsedSourceKey(projectId: string): string {
  return `site-drawings:last-import-source:${projectId}`;
}

function readLastUsedSource(projectId: string): DocSource {
  try {
    const stored = localStorage.getItem(lastUsedSourceKey(projectId));
    return stored && (IMPORT_SOURCE_OPTIONS as string[]).includes(stored) ? (stored as DocSource) : 'aconex';
  } catch {
    return 'aconex';
  }
}

function writeLastUsedSource(projectId: string, source: DocSource): void {
  try {
    localStorage.setItem(lastUsedSourceKey(projectId), source);
  } catch {
    // Best-effort convenience only; a blocked/full store just means the
    // next modal open falls back to 'aconex' again, nothing breaks.
  }
}

// Bulk ingestion (brief Phase 2): upload a ZIP of many drawings, or a
// single PDF, and hand it to the existing background import pipeline
// (SiteDrawingImportService/Processor) -- this was already fully built and
// had no UI calling it at all before this component.
export function ImportDrawingsModal({
  open, onClose, projectId, onCreated,
}: {
  open: boolean; onClose: () => void; projectId: string; onCreated: (batch: SiteDrawingImportBatch) => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sourceSystem, setSourceSystem] = useState<DocSource>(() => readLastUsedSource(projectId));
  // Phase 5: visible progress for a potentially-long upload (up to
  // 500 MB), so "Uploading…" with no further feedback isn't the only
  // sign of life on a slow connection -- and isn't indistinguishable from
  // a genuine stall (which the 15-minute upload timeout now also guards
  // against; see site-drawings.api.ts's own comment).
  const [uploadFraction, setUploadFraction] = useState(0);

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (f) setFile(f);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, maxFiles: 1,
    accept: { 'application/zip': ['.zip'], 'application/pdf': ['.pdf'] },
  });

  const mutation = useMutation({
    mutationFn: () => {
      setUploadFraction(0);
      return uploadImportBatch(projectId, file!, sourceSystem, setUploadFraction);
    },
    onSuccess: (batch) => {
      queryClient.invalidateQueries({ queryKey: ['site-drawing-import-batches', projectId] });
      writeLastUsedSource(projectId, sourceSystem);
      setFile(null); // keep sourceSystem as-is: the next package is very likely from the same source
      setUploadFraction(0);
      onClose();
      onCreated(batch);
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Import drawing package" wide>
      <div className="space-y-4">
        <p className="text-xs text-ink-500">
          Upload a ZIP package (hundreds of drawings at once) downloaded from Aconex, Procore, or another source,
          or a single PDF. Each drawing is matched against the existing register; new drawings, new revisions,
          duplicates, and conflicts are all identified automatically. Nothing is auto-approved — every imported
          revision starts unreviewed.
        </p>

        <div
          {...getRootProps()}
          className={`rounded border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-signal bg-signal/5' : 'border-base-600 hover:border-base-500'
          }`}
        >
          <input {...getInputProps()} />
          {file ? <p className="text-sm text-ink-100">{file.name}</p> : (
            <>
              <p className="text-sm text-ink-300">Drag a ZIP or PDF here, or click to browse</p>
              <p className="text-xs text-ink-500 mt-2">ZIP or PDF, up to 500 MB</p>
            </>
          )}
        </div>

        <div>
          <label className="field-label" htmlFor="import-source">Source system</label>
          <Listbox id="import-source" className="field-input" value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value as DocSource)}>
            {IMPORT_SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{sourceProviderLabel(s)}</option>)}
          </Listbox>
          <p className="text-xs text-ink-500 mt-2">
            Re-importing a later package of the same drawings? Pick the same source here, or they'll be added as new
            drawings instead of new revisions.
          </p>
        </div>

        {mutation.isPending && (
          <div className="h-1.5 rounded-full bg-base-700 overflow-hidden" role="progressbar" aria-valuenow={Math.round(uploadFraction * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-signal transition-[width]" style={{ width: `${Math.round(uploadFraction * 100)}%` }} />
          </div>
        )}

        {mutation.isError && (
          <p className="field-error">
            {apiErrorMessage(mutation.error)} Nothing was imported — click "Start import" again to retry.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!file || mutation.isPending} className="btn-primary">
            {mutation.isPending ? `Uploading… ${Math.round(uploadFraction * 100)}%` : 'Start import'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
