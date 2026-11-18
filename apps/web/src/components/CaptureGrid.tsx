import { useState } from 'react';
import type { Capture } from '@engineeringos/types';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CaptureLightbox } from './CaptureLightbox';
import { CAPTURE_STATUS_LABELS } from '../lib/capture-constants';
import { bulkDeleteCaptures } from '../lib/captures.api';
import { apiErrorMessage } from '../lib/api';

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

// Clamp bounds for card aspect ratio (width / height). A raw ratio outside
// this range (an ultra-tall portrait phone photo, or an ultra-wide stitched
// panorama) would blow out the masonry layout (one column item towering
// over or dwarfing its neighbors) so we cap the *box shape* here. The
// image itself is never cropped to fit the cap: CaptureCardBody renders it
// with object-contain, so a capture whose real ratio falls outside these
// bounds just letterboxes within the (still reasonably-shaped) box instead
// of losing any pixels.
//   MIN 0.5  ~= 1:2, well past a typical portrait phone photo (~0.56-0.75)
//   MAX 2.75 ~= comfortably past a standard 2:1 equirectangular 360 pano,
//              short of the pathological stitched-panorama case
const MIN_ASPECT_RATIO = 0.5;
const MAX_ASPECT_RATIO = 2.75;
const DEFAULT_ASPECT_RATIO = 4 / 3;

function getAspectRatio(c: Capture): number {
  const w = c.originalWidthPx;
  const h = c.originalHeightPx;
  if (typeof w === 'number' && typeof h === 'number' && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, w / h));
  }
  // Missing/invalid dimensions: older captures, or an in-flight
  // upload/processing job that hasn't produced dimensions yet.
  return DEFAULT_ASPECT_RATIO;
}

interface LocationGroup {
  key: string;
  locationName: string;
  captures: Capture[];
}

function groupByLocationId(captures: Capture[]): LocationGroup[] {
  const order: string[] = [];
  const map = new Map<string, Capture[]>();
  for (const c of captures) {
    const key = c.locationId ?? '__unassigned__';
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(c);
  }
  return order.map((key) => {
    const groupCaptures = map.get(key)!;
    const locationName =
      key === '__unassigned__'
        ? 'Unassigned'
        : groupCaptures[0].locationName || `Location ${key.slice(0, 8)}`;
    return { key, locationName, captures: groupCaptures };
  });
}

function dateRangeLabel(captures: Capture[]): string {
  const times = captures.map((c) => new Date(c.capturedAt).getTime()).filter((t) => Number.isFinite(t));
  if (times.length === 0) return '';
  const earliest = new Date(Math.min(...times)).toLocaleDateString();
  const latest = new Date(Math.max(...times)).toLocaleDateString();
  return earliest === latest ? earliest : `${earliest} to ${latest}`;
}

export function CaptureGrid({
  projectId,
  projectName,
  captures,
  hasActiveFilters = false,
  groupByLocation = false,
}: {
  projectId: string;
  projectName?: string;
  captures: Capture[];
  // True when the caller has a filter/search active, so an empty result
  // means "filters matched nothing" rather than "this project/location has
  // no captures at all". Optional and defaults to false to stay
  // backward-compatible with the other two callers (ProjectDetail.tsx,
  // drawing/PinPanel.tsx) that don't have a filter bar of their own.
  hasActiveFilters?: boolean;
  // Opt-in: render a section heading (location name, count, date range) per
  // distinct locationId instead of a flat masonry grid. Off by default so
  // ProjectDetail.tsx and PinPanel.tsx (which already scope their capture
  // set to a single location) render exactly as before, just with the new
  // masonry/aspect-ratio card layout. Only CapturesPage.tsx opts in.
  groupByLocation?: boolean;
}) {
  const [lightboxCapture, setLightboxCapture] = useState<Capture | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const bulkDeleteMutation = useMutation({
    mutationFn: () => bulkDeleteCaptures(projectId, [...selectedIds]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captures', projectId] });
      // A deleted capture also renders in BuildLens Timeline, cached per
      // location under ['viewer', projectId, locationId]; without this it
      // keeps showing there until a hard reload. No single locationId to
      // target here (the selection can span several), so invalidate the
      // whole ['viewer', projectId] prefix -- React Query matches every
      // query whose key starts with it, i.e. every location's cache.
      queryClient.invalidateQueries({ queryKey: ['viewer', projectId] });
      setSelectedIds(new Set());
      setSelecting(false);
    },
  });

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (captures.length === 0) {
    return (
      <div className="tick-frame panel p-12 text-center">
        {hasActiveFilters ? (
          <>
            <div className="text-sm font-medium mb-2">No captures match these filters</div>
            <p className="text-sm text-ink-500">Try clearing a filter or your search to see more captures.</p>
          </>
        ) : (
          <>
            <div className="text-sm font-medium mb-2">No captures here yet</div>
            <p className="text-sm text-ink-500">Upload a 360° photo, standard photo, or video to get started.</p>
          </>
        )}
      </div>
    );
  }

  // 360° photos already assigned to a location go to the immersive viewer;
  // everything else (standard photos, video, or a 360° photo with nowhere
  // to view it in context) opens in the lightbox instead of going nowhere.
  const goesToViewer = (c: Capture) => c.captureType === 'photo_360' && c.locationId;

  const renderCard = (c: Capture) => {
    // Multi-column masonry needs a block-level, full-width item for
    // break-inside-avoid to actually keep each card in one column segment
    // instead of splitting across a column break; Link renders an <a>
    // (inline by default) and button is inline-block, so both need an
    // explicit block + w-full here.
    const className = `tick-frame panel overflow-hidden group block w-full break-inside-avoid mb-4 text-left relative${
      c.captureType === 'photo_360' ? ' ring-2 ring-blueprint/40' : ''
    }`;
    const checkbox = selecting && (
      <span
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelected(c.id); }}
        className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer ${
          selectedIds.has(c.id) ? 'bg-blueprint border-blueprint' : 'bg-base-950/70 border-ink-100/60'
        }`}
      >
        {selectedIds.has(c.id) && (
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    );
    return goesToViewer(c) ? (
      <Link
        key={c.id}
        to={`/projects/${projectId}/viewer/${c.locationId}`}
        className={className}
        onClick={(e) => { if (selecting) { e.preventDefault(); toggleSelected(c.id); } }}
      >
        {checkbox}
        <CaptureCardBody c={c} />
      </Link>
    ) : (
      <button key={c.id} onClick={() => (selecting ? toggleSelected(c.id) : setLightboxCapture(c))} className={className}>
        {checkbox}
        <CaptureCardBody c={c} />
      </button>
    );
  };

  return (
    <>
      <div className="flex items-center justify-end mb-4">
        <button
          onClick={() => { setSelecting((s) => !s); setSelectedIds(new Set()); }}
          className="text-xs font-medium text-ink-500 hover:text-ink-100"
        >
          {selecting ? 'Cancel' : 'Select'}
        </button>
      </div>

      {groupByLocation ? (
        <div className="space-y-8">
          {groupByLocationId(captures).map((group) => (
            <section key={group.key}>
              <div className="flex items-baseline gap-2 mb-4">
                <h3 className="text-sm font-medium">{group.locationName}</h3>
                <span className="text-xs text-ink-500">
                  {group.captures.length} capture{group.captures.length === 1 ? '' : 's'} · {dateRangeLabel(group.captures)}
                </span>
              </div>
              <div className="columns-2 sm:columns-3 xl:columns-4 gap-4">
                {group.captures.map((c) => renderCard(c))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="columns-2 sm:columns-3 xl:columns-4 gap-4">{captures.map((c) => renderCard(c))}</div>
      )}

      {selecting && selectedIds.size > 0 && (
        <div className="sticky bottom-4 mt-4 flex items-center gap-2 tick-frame panel px-4 py-2">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <button
            onClick={() => { if (confirm(`Delete ${selectedIds.size} capture(s) and all their renditions? This cannot be undone.`)) bulkDeleteMutation.mutate(); }}
            disabled={bulkDeleteMutation.isPending}
            className="btn-danger !px-4 !py-2 text-sm ml-auto"
          >
            {bulkDeleteMutation.isPending ? 'Deleting…' : 'Delete selected'}
          </button>
          {bulkDeleteMutation.isError && <span className="text-xs text-danger">{apiErrorMessage(bulkDeleteMutation.error)}</span>}
        </div>
      )}

      <CaptureLightbox projectId={projectId} projectName={projectName} capture={lightboxCapture} onClose={() => setLightboxCapture(null)} />
    </>
  );
}

function CaptureCardBody({ c }: { c: Capture }) {
  const aspectRatio = getAspectRatio(c);
  return (
    <>
      <div className="bg-base-900 relative overflow-hidden" style={{ aspectRatio }}>
        {c.thumbnailUrl ? (
          <img
            src={c.thumbnailUrl}
            alt={c.title ?? 'Capture'}
            loading="lazy"
            // The box is now sized to the capture's own (clamped) aspect
            // ratio rather than a forced 16:9, so object-contain never
            // crops: when the box ratio matches the image exactly (the
            // common case) it fills the box edge-to-edge with no letterbox;
            // when the ratio was clamped (an extreme pano/portrait) it
            // letterboxes against bg-base-900 instead of cropping pixels.
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink-500">
            <CameraIcon className="w-6 h-6" />
          </div>
        )}
        <span className="absolute top-2 left-2 badge bg-base-950/80 text-ink-100 backdrop-blur">
          {TYPE_LABEL[c.captureType] ?? c.captureType}
        </span>
        <span className={`absolute top-2 right-2 badge ${STATUS_STYLES[c.status] ?? 'bg-base-700 text-ink-300'}`}>
          {CAPTURE_STATUS_LABELS[c.status] ?? c.status}
        </span>
      </div>
      <div className="p-4">
        <div className="text-xs font-medium truncate">{c.title ?? 'Untitled capture'}</div>
        <div className="text-xs font-mono text-ink-500 mt-0">
          {new Date(c.capturedAt).toLocaleDateString()} {c.phase ? `· ${c.phase.replace(/_/g, ' ')}` : ''}
        </div>
      </div>
    </>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" strokeLinejoin="round" /><circle cx="12" cy="13.5" r="3.2" />
    </svg>
  );
}
