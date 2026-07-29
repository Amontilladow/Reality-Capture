import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { uploadDrawing } from '../../lib/drawings.api';
import { apiErrorMessage } from '../../lib/api';
import type { ProjectHierarchy } from '../../lib/projects.api';
import { BuildingLevelRoomPicker, type HierarchySelection } from '../hierarchy/BuildingLevelRoomPicker';

export function DrawingUploadModal({
  open,
  onClose,
  projectId,
  hierarchy,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  hierarchy: ProjectHierarchy[];
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState<HierarchySelection>({ buildingId: '', levelId: '', locationId: '' });

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (f) {
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.pdf$/i, ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
  });

  const mutation = useMutation({
    mutationFn: () =>
      uploadDrawing(projectId, file!, {
        title,
        levelId: place.levelId || undefined,
        locationId: place.locationId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drawings', projectId] });
      setFile(null);
      setTitle('');
      setPlace({ buildingId: '', levelId: '', locationId: '' });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Upload floor plan" wide>
      <div className="space-y-4">
        <div
          {...getRootProps()}
          className={`rounded border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-signal bg-signal/5' : 'border-base-600 hover:border-base-500'
          }`}
        >
          <input {...getInputProps()} />
          {file ? (
            <p className="text-sm text-ink-100">{file.name}</p>
          ) : (
            <>
              <p className="text-sm text-ink-300">Drag a PDF here, or click to browse</p>
              <p className="text-xs text-ink-500 mt-1">Single-sheet floor plan drawing</p>
            </>
          )}
        </div>

        <div>
          <label className="field-label" htmlFor="title">Title</label>
          <input id="title" className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <BuildingLevelRoomPicker projectId={projectId} hierarchy={hierarchy} value={place} onChange={setPlace} />

        {mutation.isError && (
          <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
            {apiErrorMessage(mutation.error)}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            className="btn-primary flex-1"
            disabled={!file || !title || mutation.isPending}
          >
            {mutation.isPending ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
