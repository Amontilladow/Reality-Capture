import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Capture } from '@engineeringos/types';
import { updateCapture } from '../lib/captures.api';

export function CaptureLightbox({
  projectId,
  capture,
  onClose,
}: {
  projectId: string;
  capture: (Capture & { thumbnailUrl?: string; previewUrl?: string }) | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');

  useEffect(() => {
    setTitle(capture?.title ?? '');
    setEditingTitle(false);
  }, [capture?.id]);

  const renameMutation = useMutation({
    mutationFn: () => updateCapture(projectId, capture!.id, { title: title.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captures', projectId] });
      setEditingTitle(false);
    },
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (capture) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capture, onClose]);

  if (!capture) return null;
  const src = capture.previewUrl ?? capture.thumbnailUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-base-950/90 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[90vh] tick-frame panel overflow-hidden flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-base-600 shrink-0">
          {editingTitle ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                autoFocus
                className="field-input !py-1.5"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') renameMutation.mutate(); }}
              />
              <button onClick={() => renameMutation.mutate()} disabled={renameMutation.isPending} className="btn-primary !px-3 !py-1.5 text-xs shrink-0">
                Save
              </button>
              <button onClick={() => setEditingTitle(false)} className="btn-ghost !px-2 !py-1.5 text-xs shrink-0">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setEditingTitle(true)} className="text-sm font-medium truncate hover:text-blueprint text-left flex items-center gap-1.5 min-w-0">
              <span className="truncate">{capture.title || 'Untitled capture'}</span>
              <EditIcon className="w-3.5 h-3.5 text-ink-500 shrink-0" />
            </button>
          )}
          <button onClick={onClose} className="text-ink-500 hover:text-ink-100 shrink-0" aria-label="Close">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-base-950 flex items-center justify-center overflow-hidden">
          {capture.captureType === 'video' ? (
            src ? <video src={src} controls className="max-w-full max-h-[70vh]" /> : <EmptyState />
          ) : src ? (
            <img src={src} alt={capture.title ?? 'Capture'} className="max-w-full max-h-[70vh] object-contain" />
          ) : (
            <EmptyState />
          )}
        </div>

        <div className="px-4 py-3 border-t border-base-600 flex items-center gap-4 text-xs text-ink-500 shrink-0">
          <span>{new Date(capture.capturedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          {capture.phase && <span>{capture.phase.replace(/_/g, ' ')}</span>}
          <span className="ml-auto uppercase font-mono">{capture.status}</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return <div className="text-ink-500 text-sm py-16">No preview available yet.</div>;
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
