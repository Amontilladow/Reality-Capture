import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { uploadBimModel } from '../lib/bim.api';
import { apiErrorMessage } from '../lib/api';

interface QueuedFile {
  id: string;
  file: File;
  name: string;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

export function BimModelUploadModal({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => [
      ...prev,
      ...accepted.map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name.replace(/\.ifc$/i, ''),
        progress: 0,
        status: 'queued' as const,
      })),
    ]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/octet-stream': ['.ifc'] },
  });

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function renameFile(id: string, name: string) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
  }

  async function startUpload() {
    setUploading(true);
    for (const qf of files) {
      if (qf.status === 'done') continue;
      setFiles((prev) => prev.map((f) => (f.id === qf.id ? { ...f, status: 'uploading' } : f)));
      try {
        await uploadBimModel(
          projectId,
          qf.file,
          qf.name,
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
    queryClient.invalidateQueries({ queryKey: ['bim-models', projectId] });
  }

  function handleClose() {
    if (uploading) return;
    setFiles([]);
    onClose();
  }

  const allDone = files.length > 0 && files.every((f) => f.status === 'done' || f.status === 'error');

  return (
    <Modal open={open} onClose={handleClose} title="Upload IFC model">
      <div className="space-y-4">
        <div
          {...getRootProps()}
          className={`rounded-lg border-2 border-dashed p-8 text-center cursor-pointer ${
            isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
          }`}
        >
          <input {...getInputProps()} />
          <p className="text-sm text-gray-600">
            {isDragActive ? 'Drop the IFC file here…' : 'Drag & drop an .ifc file, or click to browse'}
          </p>
        </div>

        {files.length > 0 && (
          <ul className="space-y-2">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 rounded border border-gray-200 p-2">
                <input
                  className="field-input flex-1"
                  value={f.name}
                  disabled={f.status !== 'queued'}
                  onChange={(e) => renameFile(f.id, e.target.value)}
                />
                <span className="w-16 text-xs text-gray-500">
                  {f.status === 'uploading' ? `${f.progress}%` : f.status}
                </span>
                {f.status === 'queued' && (
                  <button type="button" className="text-xs text-red-600" onClick={() => removeFile(f.id)}>
                    Remove
                  </button>
                )}
                {f.error && <span className="text-xs text-red-600">{f.error}</span>}
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={handleClose} disabled={uploading}>
            {allDone ? 'Close' : 'Cancel'}
          </button>
          {!allDone && (
            <button
              type="button"
              className="btn-primary"
              onClick={startUpload}
              disabled={uploading || files.length === 0}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
