import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectPhase } from '@engineeringos/types';
import { PROJECT_PHASES, PROJECT_PHASE_LABELS } from '@engineeringos/types';
import type { Pin } from '../../lib/drawings.api';
import { listCaptures, uploadCapture } from '../../lib/captures.api';
import { updateLocation, archiveLocation } from '../../lib/projects.api';
import { CaptureGrid } from '../CaptureGrid';
import { apiErrorMessage } from '../../lib/api';

export function PinPanel({
  projectId,
  pin,
  onClose,
  onMove,
  onDeleted,
}: {
  projectId: string;
  pin: Pin | null;
  onClose: () => void;
  onMove: (pin: Pin) => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<ProjectPhase | ''>('');

  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const lastSavedTitle = useRef('');
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState('');
  const lastSavedNote = useRef('');

  useEffect(() => {
    const n = pin?.name ?? '';
    const d = pin?.description ?? '';
    setTitle(n);
    lastSavedTitle.current = n;
    setNote(d);
    lastSavedNote.current = d;
    setPhase(''); // this is a per-upload selection, not a saved pin property -- must reset on every pin switch, not carry over
    setEditingTitle(false);
    setEditingNote(false);
  }, [pin?.locationId]);

  function invalidatePin() {
    // Refreshes the marker list on the plan -- but the panel you're looking
    // at right now is holding a snapshot `pin` prop, not this query's data,
    // so it will NOT pick up the change on its own. Display below reads
    // from `title`/`note` (already holding the just-saved value) instead
    // of `pin.name`/`pin.description` specifically to avoid that gap.
    queryClient.invalidateQueries({ queryKey: ['pins', projectId] });
  }

  const renameMutation = useMutation({
    mutationFn: () => updateLocation(projectId, pin!.locationId, { name: title.trim() || 'Untitled pin' }),
    onSuccess: () => {
      lastSavedTitle.current = title.trim() || 'Untitled pin';
      setTitle(lastSavedTitle.current);
      invalidatePin();
      setEditingTitle(false);
    },
  });

  const noteMutation = useMutation({
    mutationFn: () => updateLocation(projectId, pin!.locationId, { description: note }),
    onSuccess: () => {
      lastSavedNote.current = note;
      invalidatePin();
      setEditingNote(false);
    },
  });

  const capturesQuery = useQuery({
    queryKey: ['captures', projectId, 'pin', pin?.locationId],
    queryFn: () => listCaptures(projectId, { locationId: pin!.locationId, perPage: 50 }),
    enabled: Boolean(pin),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveLocation(projectId, pin!.locationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pins', projectId] });
      onDeleted();
    },
  });

  function handleDelete() {
    if (!pin) return;
    if (confirm('Delete this pin? Its photos, videos, and notes will be hidden, not permanently lost.')) {
      archiveMutation.mutate();
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!file || !pin) return;

    setUploading(true);
    setError('');
    try {
      await uploadCapture(projectId, file, {
        captureType: file.type.startsWith('video/') ? 'video' : 'photo_standard',
        locationId: pin.locationId,
        title: file.name.replace(/\.[^./]+$/, ''),
        phase: phase || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['captures', projectId, 'pin', pin.locationId] });
      invalidatePin();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  if (!pin) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-base-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] tick-frame panel overflow-hidden flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-base-600 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500 mb-0.5">Pin</div>
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  className="field-input !py-1.5 text-base font-semibold"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') renameMutation.mutate(); if (e.key === 'Escape') { setTitle(lastSavedTitle.current); setEditingTitle(false); } }}
                />
                <button onClick={() => renameMutation.mutate()} disabled={renameMutation.isPending} className="btn-primary !px-3 !py-1.5 text-xs shrink-0">
                  Save
                </button>
                <button onClick={() => { setTitle(lastSavedTitle.current); setEditingTitle(false); }} className="btn-ghost !px-2 !py-1.5 text-xs shrink-0">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setEditingTitle(true)} className="flex items-center gap-1.5 min-w-0 hover:text-blueprint text-left">
                <h3 className="text-base font-semibold truncate">{title || 'Untitled pin'}</h3>
                <EditIcon className="w-3.5 h-3.5 text-ink-500 shrink-0" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onMove(pin)} className="btn-ghost !px-2.5 !py-1.5 text-xs" title="Move this pin to a new spot on the drawing">
              Move
            </button>
            <button
              onClick={handleDelete}
              disabled={archiveMutation.isPending}
              className="btn-ghost !px-2.5 !py-1.5 text-xs text-danger hover:!bg-danger/10"
            >
              {archiveMutation.isPending ? 'Deleting…' : 'Delete'}
            </button>
            <button onClick={onClose} className="text-ink-500 hover:text-ink-100 !px-1" aria-label="Close">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        {archiveMutation.isError && (
          <p className="field-error px-5 pt-2">{apiErrorMessage(archiveMutation.error)}</p>
        )}

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Note */}
          <div>
            <div className="field-label">Note</div>
            {editingNote ? (
              <div className="space-y-2">
                <textarea
                  autoFocus
                  className="field-input min-h-[72px]"
                  placeholder="Add a note about this pin…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <button onClick={() => noteMutation.mutate()} disabled={noteMutation.isPending} className="btn-primary !px-3 !py-1.5 text-xs">
                    {noteMutation.isPending ? 'Saving…' : 'Save note'}
                  </button>
                  <button onClick={() => { setNote(lastSavedNote.current); setEditingNote(false); }} className="btn-ghost !px-2 !py-1.5 text-xs">Cancel</button>
                </div>
              </div>
            ) : note ? (
              <button onClick={() => setEditingNote(true)} className="panel p-3 text-sm text-ink-100 text-left w-full hover:border-blueprint/50 transition-colors">
                {note}
              </button>
            ) : (
              <button onClick={() => setEditingNote(true)} className="text-sm text-ink-500 hover:text-blueprint">
                + Add a note
              </button>
            )}
          </div>

          {/* Camera-first add-media: capture="environment" is a no-op on desktop
              (opens a normal file picker) and opens the camera directly on a
              phone -- included now even though mobile polish is a later phase,
              since it costs nothing extra here. */}
          <div>
            <label className="field-label" htmlFor="pinPhase">Phase (applies to the next upload)</label>
            <select
              id="pinPhase"
              className="field-input mb-2"
              value={phase}
              onChange={(e) => setPhase(e.target.value as ProjectPhase | '')}
            >
              <option value="">Unspecified</option>
              {PROJECT_PHASES.map((p) => (
                <option key={p} value={p}>{PROJECT_PHASE_LABELS[p]}</option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              className="hidden"
              onChange={handleFile}
            />
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="btn-primary w-full justify-center">
              {uploading ? 'Uploading…' : '+ Add photo or video'}
            </button>
            {error && <p className="field-error">{error}</p>}
          </div>

          <div>
            <div className="field-label">
              History ({capturesQuery.data?.data.length ?? 0})
            </div>
            {capturesQuery.isLoading && <p className="text-sm text-ink-500">Loading…</p>}
            {capturesQuery.data && capturesQuery.data.data.length > 0 ? (
              <CaptureGrid projectId={projectId} captures={capturesQuery.data.data} />
            ) : (
              !capturesQuery.isLoading && (
                <div className="panel p-8 text-center text-sm text-ink-500">
                  Nothing here yet — add the first photo or video above.
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
