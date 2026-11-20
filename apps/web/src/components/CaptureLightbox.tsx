import { confirmDialog } from '../store/confirm.store';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../lib/use-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Capture, ProjectPhase } from '@engineeringos/types';
import { PROJECT_PHASES, PROJECT_PHASE_LABELS } from '@engineeringos/types';
import { updateCapture, deleteCapture } from '../lib/captures.api';
import { apiErrorMessage } from '../lib/api';
import { Listbox } from './ui/Listbox';

export function CaptureLightbox({
  projectId,
  projectName,
  capture,
  onClose,
}: {
  projectId: string;
  projectName?: string;
  capture: (Capture & { thumbnailUrl?: string; previewUrl?: string }) | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialog(Boolean(capture), onClose, panelRef);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [editingPhase, setEditingPhase] = useState(false);
  const [phase, setPhase] = useState<ProjectPhase | ''>('');

  // Resets the local edit buffer only when the selected capture changes.
  // Deliberately excludes capture?.title/capture?.phase: once a rename or
  // phase-change mutation succeeds, the parent's `capture` prop updates to
  // match, and re-running this on that change would immediately overwrite
  // the mutation's own onSuccess (e.g. setEditingTitle(false)) with a fresh
  // reset of the same capture.
  useEffect(() => {
    setTitle(capture?.title ?? '');
    setPhase((capture?.phase as ProjectPhase) ?? '');
    setEditingTitle(false);
    setEditingPhase(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture?.id]);

  const renameMutation = useMutation({
    mutationFn: () => updateCapture(projectId, capture!.id, { title: title.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captures', projectId] });
      setEditingTitle(false);
    },
  });

  const phaseMutation = useMutation({
    mutationFn: () => updateCapture(projectId, capture!.id, { phase: phase || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captures', projectId] });
      setEditingPhase(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCapture(projectId, capture!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captures', projectId] });
      // This same capture also renders in BuildLens Timeline, cached per
      // location under ['viewer', projectId, locationId]; without this it
      // keeps showing there until a hard reload re-fetches it from scratch.
      if (capture?.locationId) {
        queryClient.invalidateQueries({ queryKey: ['viewer', projectId, capture.locationId] });
      }
      onClose();
    },
  });

  if (!capture) return null;
  const src = capture.previewUrl ?? capture.thumbnailUrl;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6">
      <div className="dialog-backdrop-in absolute inset-0 bg-base-950/80 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Capture" tabIndex={-1} className="dialog-in relative w-full max-w-3xl max-h-[calc(100dvh-2rem)] sm:max-h-[min(90dvh,calc(100dvh-3rem))] rounded-2xl border border-ink-100/10 bg-base-800 text-ink-100 shadow-xl overflow-hidden flex flex-col focus:outline-none">
        <div className="flex items-start justify-between gap-4 px-4 py-4 border-b border-base-600 shrink-0">
          <div className="min-w-0 flex-1">
          {editingTitle ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                autoFocus
                className="field-input !py-2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') renameMutation.mutate(); }}
              />
              <button onClick={() => renameMutation.mutate()} disabled={renameMutation.isPending} className="btn-primary !px-4 !py-2 shrink-0">
                Save
              </button>
              <button onClick={() => setEditingTitle(false)} className="btn-ghost !px-2 !py-2 shrink-0">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setEditingTitle(true)} className="text-sm font-medium truncate hover:text-blueprint text-left flex items-center gap-2 min-w-0">
              <span className="truncate">{capture.title || 'Untitled capture'}</span>
              <EditIcon className="w-3.5 h-3.5 text-ink-500 shrink-0" />
            </button>
          )}
          {(projectName || capture.buildingName || capture.levelName || capture.locationName) && (
            <div className="text-xs text-ink-500 mt-2 truncate">
              {[projectName, capture.buildingName, capture.levelName, capture.locationName].filter(Boolean).join(' · ')}
            </div>
          )}
          </div>
          <button onClick={onClose} className="text-ink-500 hover:text-ink-100 shrink-0" aria-label="Close">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-base-950 flex items-center justify-center overflow-hidden">
          {capture.captureType === 'video' ? (
            src ? <video src={src} controls preload="metadata" className="max-w-full max-h-[70vh]" /> : <EmptyState />
          ) : src ? (
            <img src={src} alt={capture.title ?? 'Capture'} className="max-w-full max-h-[70vh] object-contain" />
          ) : (
            <EmptyState />
          )}
        </div>

        <div className="px-4 py-4 border-t border-base-600 flex items-center gap-4 text-xs text-ink-500 shrink-0 flex-wrap">
          <span>{new Date(capture.capturedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>

          {editingPhase ? (
            <div className="flex items-center gap-2">
              <Listbox aria-label="Phase"
                autoFocus
                className="field-input !py-2 !text-xs w-auto"
                value={phase}
                onChange={(e) => setPhase(e.target.value as ProjectPhase | '')}
              >
                <option value="">Unspecified</option>
                {PROJECT_PHASES.map((p) => (
                  <option key={p} value={p}>{PROJECT_PHASE_LABELS[p]}</option>
                ))}
              </Listbox>
              <button onClick={() => phaseMutation.mutate()} disabled={phaseMutation.isPending} className="btn-primary !px-2 !py-2 shrink-0">
                Save
              </button>
              <button onClick={() => { setPhase((capture.phase as ProjectPhase) ?? ''); setEditingPhase(false); }} className="btn-ghost !px-2 !py-2 shrink-0">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setEditingPhase(true)} className="flex items-center gap-2 hover:text-blueprint">
              <span>{phase ? PROJECT_PHASE_LABELS[phase] : 'Set phase'}</span>
              <EditIcon className="w-3 h-3" />
            </button>
          )}

          <span className="capitalize">{capture.status}</span>

          <button
            onClick={async () => { if (await confirmDialog('Delete this capture and all its renditions? This cannot be undone.')) deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending}
            className="ml-auto flex items-center gap-2 text-danger hover:text-danger"
          >
            <TrashIcon className="w-3.5 h-3.5" />
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
        {deleteMutation.isError && (
          <div className="px-4 pb-2 -mt-2 text-xs text-danger shrink-0">{apiErrorMessage(deleteMutation.error)}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function EmptyState() {
  return <div className="text-ink-500 text-sm py-16">No preview available yet.</div>;
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
