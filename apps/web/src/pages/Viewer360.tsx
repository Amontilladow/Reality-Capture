import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Capture, Hotspot } from '@engineeringos/types';
import { ThreeJsViewer } from '../components/viewer/ThreeJsViewer';
import { getViewerData, getCapture } from '../lib/captures.api';
import { getHierarchy } from '../lib/projects.api';

export default function Viewer360() {
  const { projectId, locationId } = useParams<{ projectId: string; locationId: string }>();
  const navigate = useNavigate();
  const [activeCaptureId, setActiveCaptureId] = useState<string | null>(null);

  const viewerQuery = useQuery({
    queryKey: ['viewer', projectId, locationId],
    queryFn: () => getViewerData(projectId!, locationId!),
    enabled: Boolean(projectId && locationId),
  });

  const hierarchyQuery = useQuery({
    queryKey: ['hierarchy', projectId],
    queryFn: () => getHierarchy(projectId!),
    enabled: Boolean(projectId),
  });

  const captures = viewerQuery.data ?? [];
  const active: Capture | undefined =
    captures.find((c) => c.id === activeCaptureId) ?? captures[0];

  const activeDetailQuery = useQuery({
    queryKey: ['capture', projectId, active?.id],
    queryFn: () => getCapture(projectId!, active!.id),
    enabled: Boolean(projectId && active?.id),
  });

  const imageUrl = activeDetailQuery.data?.previewUrl ?? active?.previewUrl ?? active?.thumbnailUrl;
  const hotspots: Hotspot[] = activeDetailQuery.data?.hotspots ?? [];

  const locationLabel = useMemo(() => {
    for (const b of hierarchyQuery.data ?? []) {
      for (const l of b.levels ?? []) {
        const loc = (l.locations ?? []).find((x) => x.id === locationId);
        if (loc) return `${b.name} · ${l.name} · ${loc.name}`;
      }
    }
    return null;
  }, [hierarchyQuery.data, locationId]);

  function handleHotspotClick(h: Hotspot) {
    if (h.hotspotType === 'navigation' && h.targetCaptureId) {
      const target = captures.find((c) => c.id === h.targetCaptureId);
      if (target) {
        setActiveCaptureId(target.id);
      } else {
        // Target capture lives at a different location — fetch it to resolve where.
        getCapture(projectId!, h.targetCaptureId).then((c) => {
          if (c.locationId) navigate(`/projects/${projectId}/viewer/${c.locationId}`);
        });
      }
    }
  }

  if (!projectId || !locationId) return null;

  return (
    <div className="h-screen flex flex-col">
      <div className="h-14 border-b border-base-600 bg-base-900/80 backdrop-blur px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate(`/projects/${projectId}`)} className="text-ink-500 hover:text-ink-100 shrink-0">
            <BackIcon />
          </button>
          <div className="min-w-0">
            <div className="text-xs font-mono text-ink-500 truncate">{locationLabel ?? 'Reality capture'}</div>
            <div className="text-sm font-medium truncate">{active?.title ?? 'Untitled capture'}</div>
          </div>
        </div>

        {captures.length > 1 && (
          <select
            className="field-input w-auto text-xs"
            value={active?.id ?? ''}
            onChange={(e) => setActiveCaptureId(e.target.value)}
          >
            {captures.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title ?? new Date(c.capturedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex-1 relative">
        {viewerQuery.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-ink-500 text-sm">
            Loading captures for this location…
          </div>
        )}
        {viewerQuery.isSuccess && captures.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-ink-500 text-sm">
            No 360° captures registered at this location yet.
          </div>
        )}
        {imageUrl && (
          <ThreeJsViewer imageUrl={imageUrl} hotspots={hotspots} onHotspotClick={handleHotspotClick} />
        )}
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
