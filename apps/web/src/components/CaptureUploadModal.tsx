import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import type { CaptureType, Location } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { uploadCapture } from '../lib/captures.api';
import { apiErrorMessage } from '../lib/api';

interface QueuedFile {
  id: string;
  file: File;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

export function CaptureUploadModal({
  open,
  onClose,
  projectId,
  locations,
  defaultLocationId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  locations: Location[];
  defaultLocationId?: string;
}) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [captureType, setCaptureType] = useState<CaptureType>('photo_360');
  const [locationId, setLocationId] = useState<string>(defaultLocationId ?? '');
  const [uploading, setUploading] = useState(false);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => [
      ...prev,
      ...accepted.map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        progress: 0,
        status: 'queued' as const,
      })),
    ]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [], 'video/*': [] },
  });

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function startUpload() {
    setUploading(true);
    for (const qf of files) {
      if (qf.status === 'done') continue;
      setFiles((prev) => prev.map((f) => (f.id === qf.id ? { ...f, status: 'uploading' } : f)));
      try {
        await uploadCapture(
          projectId,
          qf.file,
          {
            captureType,
            locationId: locationId || undefined,
            // No title field in this quick-upload flow — default to the
            // filename rather than leaving every capture "Untitled".
            title: qf.file.name.replace(/\.[^./]+$/, ''),
          },
          (pct) => setFiles((prev) => prev.map((f) => (f.id === qf.id ? { ...f, progress: pct } : f))),
        );
        setFiles((prev) => prev.map((f) => (f.id === qf.id ? { ...f, status: 'done', progress: 100 } : f)));
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) => (f.id === qf.id ? { ...f, status: 'error', error: apiErrorMessage(err) } : f)),
        );
      }
    }
    setUploading(false);
    queryClient.invalidateQueries({ queryKey: ['captures', projectId] });
  }

  function handleClose() {
    if (uploading) return;
    setFiles([]);
    onClose();
  }

  const allDone = files.length > 0 && files.every((f) => f.status === 'done' || f.status === 'error');

  return (
    <Modal open={open} onClose={handleClose} title="Upload captures">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="captureType">Capture type</label>
            <select
              id="captureType"
              className="field-input"
              value={captureType}
              onChange={(e) => setCaptureType(e.target.value as CaptureType)}
            >
              <option value="photo_360">360° photo</option>
              <option value="photo_standard">Standard photo</option>
              <option value="video">Video</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="locationId">Location</label>
            <select
              id="locationId"
              className="field-input"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div
          {...getRootProps()}
          className={`rounded border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-signal bg-signal/5' : 'border-base-600 hover:border-base-500'
          }`}
        >
          <input {...getInputProps()} />
          <UploadIcon className="w-6 h-6 mx-auto mb-2 text-ink-500" />
          <p className="text-sm text-ink-300">Drag files here, or click to browse</p>
          <p className="text-xs text-ink-500 mt-1">Images and video — uploaded directly to storage</p>
        </div>

        {files.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {files.map((f) => (
              <div key={f.id} className="flex items-center gap-3 text-xs">
                <span className="flex-1 truncate">{f.file.name}</span>
                {f.status === 'queued' && !uploading && (
                  <button onClick={() => removeFile(f.id)} className="text-ink-500 hover:text-danger">
                    Remove
                  </button>
                )}
                {(f.status === 'uploading' || f.status === 'done') && (
                  <div className="w-24 h-1.5 rounded-full bg-base-700 overflow-hidden shrink-0">
                    <div
                      className={`h-full ${f.status === 'done' ? 'bg-ok' : 'bg-blueprint'}`}
                      style={{ width: `${f.progress}%` }}
                    />
                  </div>
                )}
                {f.status === 'error' && <span className="text-danger shrink-0">{f.error ?? 'Failed'}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={handleClose} className="btn-secondary flex-1" disabled={uploading}>
            {allDone ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={startUpload}
            className="btn-primary flex-1"
            disabled={files.length === 0 || uploading || allDone}
          >
            {uploading ? 'Uploading…' : `Upload ${files.length || ''}`.trim()}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 16V4M7 9l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" strokeLinecap="round" />
    </svg>
  );
}
