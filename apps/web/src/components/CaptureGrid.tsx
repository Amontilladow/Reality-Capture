import { useState } from 'react';
import type { Capture } from '@engineeringos/types';
import { Link } from 'react-router-dom';
import { CaptureLightbox } from './CaptureLightbox';

const TYPE_LABEL: Record<string, string> = {
  photo_360: '360°',
  photo_standard: 'Photo',
  video: 'Video',
};

const STATUS_STYLES: Record<string, string> = {
  ready: 'bg-ok/15 text-ok',
  processing: 'bg-blueprint/15 text-blueprint',
  uploading: 'bg-warn/15 text-warn',
  failed: 'bg-danger/15 text-danger',
};

export function CaptureGrid({ projectId, captures }: { projectId: string; captures: Capture[] }) {
  const [lightboxCapture, setLightboxCapture] = useState<Capture | null>(null);

  if (captures.length === 0) {
    return (
      <div className="tick-frame panel p-12 text-center">
        <div className="text-sm font-medium mb-1">No captures here yet</div>
        <p className="text-sm text-ink-500">Upload a 360° photo, standard photo, or video to get started.</p>
      </div>
    );
  }

  // 360° photos already assigned to a location go to the immersive viewer —
  // everything else (standard photos, video, or a 360° photo with nowhere
  // to view it in context) opens in the lightbox instead of going nowhere.
  const goesToViewer = (c: Capture) => c.captureType === 'photo_360' && c.locationId;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
        {captures.map((c) =>
          goesToViewer(c) ? (
            <Link key={c.id} to={`/projects/${projectId}/viewer/${c.locationId}`} className="tick-frame panel overflow-hidden group">
              <CaptureCardBody c={c} />
            </Link>
          ) : (
            <button key={c.id} onClick={() => setLightboxCapture(c)} className="tick-frame panel overflow-hidden group text-left">
              <CaptureCardBody c={c} />
            </button>
          ),
        )}
      </div>

      <CaptureLightbox projectId={projectId} capture={lightboxCapture} onClose={() => setLightboxCapture(null)} />
    </>
  );
}

function CaptureCardBody({ c }: { c: Capture }) {
  return (
    <>
      <div className="aspect-video bg-base-900 relative overflow-hidden">
        {c.thumbnailUrl ? (
          <img src={c.thumbnailUrl} alt={c.title ?? 'Capture'} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink-500">
            <CameraIcon className="w-6 h-6" />
          </div>
        )}
        <span className="absolute top-2 left-2 badge bg-base-950/80 text-ink-100 backdrop-blur">
          {TYPE_LABEL[c.captureType] ?? c.captureType}
        </span>
        <span className={`absolute top-2 right-2 badge ${STATUS_STYLES[c.status] ?? 'bg-base-700 text-ink-300'}`}>
          {c.status}
        </span>
      </div>
      <div className="p-3">
        <div className="text-xs font-medium truncate">{c.title ?? 'Untitled capture'}</div>
        <div className="text-[10px] font-mono text-ink-500 mt-0.5">
          {new Date(c.capturedAt).toLocaleDateString()} {c.phase ? `· ${c.phase.replace(/_/g, ' ')}` : ''}
        </div>
      </div>
    </>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" strokeLinejoin="round" /><circle cx="12" cy="13.5" r="3.2" />
    </svg>
  );
}
