import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Capture, Hotspot, Location } from '@engineeringos/types';
import { PageHeader } from '../components/layout/PageHeader';
import { ThreeJsViewer } from '../components/viewer/ThreeJsViewer';
import { CaptureUploadModal } from '../components/CaptureUploadModal';
import { getViewerData, getCapture, updateCapture } from '../lib/captures.api';
import { getHierarchy } from '../lib/projects.api';

const SPEEDS = [0.5, 1, 2, 4, 8] as const;
// Base time between auto-advance steps at 1x. Scaled inversely by speed
// below (e.g. 2x -> 1250ms, 0.5x -> 5000ms) so the relative speeds line up
// with their labels.
const BASE_STEP_MS = 2500;

/**
 * Orientation continuity across a capture switch.
 *
 * `compass_heading_deg` is the real-world bearing the camera faced when a
 * given photo's own equirectangular "yaw 0" reference column was captured.
 * ThreeJsViewer's `lon` is a yaw purely relative to whichever image is
 * currently loaded -- it means nothing across two different photos on its
 * own, which is exactly the bug this function exists to fix.
 *
 * Derivation: if the viewer is currently at screen-space `currentLon`
 * degrees relative to the OUTGOING capture's zero-point, and that
 * zero-point sits at real-world bearing `outgoingHeadingDeg`, then the
 * real-world bearing currently on screen is:
 *
 *   realBearing = outgoingHeadingDeg + currentLon
 *
 * (this relies on yaw increasing in the same rotational sense as compass
 * bearing -- i.e. panning right turns you clockwise in the real world,
 * which is the standard, non-mirrored convention for equirectangular
 * panoramas, and is exactly the convention ThreeJsViewer's own theta/target
 * math already uses consistently for every image it loads).
 *
 * To keep looking at that same real-world bearing after switching to the
 * INCOMING capture (zero-point at `incomingHeadingDeg`), solve for the new
 * lon:
 *
 *   incomingHeadingDeg + lon' = realBearing = outgoingHeadingDeg + currentLon
 *   lon' = currentLon + (outgoingHeadingDeg - incomingHeadingDeg)
 *
 * Worked check (from the ticket): capture A heading 0°, capture B heading
 * 90°, user at lon=0 on A (i.e. looking at real bearing 0°, "the north
 * wall"). Switching to B: lon' = 0 + (0 - 90) = -90. Real bearing on B at
 * lon'=-90 is 90 + (-90) = 0 -- still the north wall. Correct.
 * (The naive `lon + (incoming - outgoing)` = 0 + 90 = 90 would put the real
 * bearing at 90 + 90 = 180 -- the wall directly behind the correct one --
 * so that sign is deliberately NOT used here.)
 */
function computeContinuationYaw(
  currentLon: number,
  outgoingHeadingDeg: number | null | undefined,
  incomingHeadingDeg: number | null | undefined,
): number {
  if (outgoingHeadingDeg == null || incomingHeadingDeg == null) return currentLon;
  return currentLon + (outgoingHeadingDeg - incomingHeadingDeg);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in local time (no offset).
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BuildLensTimelinePage() {
  const { projectId, locationId } = useParams<{ projectId: string; locationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeCaptureId, setActiveCaptureId] = useState<string | null>(null);
  const [currentYaw, setCurrentYaw] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [compareMode, setCompareMode] = useState(false);
  const [compareLeftId, setCompareLeftId] = useState<string>('');
  const [compareRightId, setCompareRightId] = useState<string>('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [dateBuffer, setDateBuffer] = useState('');

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

  // getViewerData() returns every capture type at this location, ordered
  // captured_at DESC. BuildLens only cares about 360° captures, and wants
  // them oldest-to-newest left-to-right, so filter then reverse.
  const captures = useMemo<Capture[]>(() => {
    const all = viewerQuery.data ?? [];
    return all.filter((c) => c.captureType === 'photo_360').slice().reverse();
  }, [viewerQuery.data]);

  const active: Capture | undefined = captures.find((c) => c.id === activeCaptureId) ?? captures[0];

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
        if (loc) return [b.name, l.name, loc.name].filter(Boolean).join(' · ');
      }
    }
    return null;
  }, [hierarchyQuery.data, locationId]);

  const currentLocation: Location | undefined = useMemo(() => {
    for (const b of hierarchyQuery.data ?? []) {
      for (const l of b.levels ?? []) {
        const loc = (l.locations ?? []).find((x) => x.id === locationId);
        if (loc) return loc;
      }
    }
    return undefined;
  }, [hierarchyQuery.data, locationId]);

  // Reset the date-edit buffer whenever the active capture changes -- same
  // pattern as CaptureLightbox's title/phase edit buffers.
  useEffect(() => {
    setDateBuffer(active ? toDatetimeLocalValue(active.capturedAt) : '');
    setEditingDate(false);
  }, [active?.id]);

  // Default the compare pickers to the earliest and latest captures once
  // the list has loaded.
  useEffect(() => {
    if (captures.length > 0 && !compareLeftId) setCompareLeftId(captures[0].id);
    if (captures.length > 0 && !compareRightId) setCompareRightId(captures[captures.length - 1].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captures.length]);

  function goTo(target: Capture) {
    if (active && target.id !== active.id) {
      setCurrentYaw((prevYaw) => computeContinuationYaw(prevYaw, active.compassHeadingDeg, target.compassHeadingDeg));
    }
    setActiveCaptureId(target.id);
  }

  function handleHotspotClick(h: Hotspot) {
    if (h.hotspotType !== 'navigation' || !h.targetCaptureId) return;
    const target = captures.find((c) => c.id === h.targetCaptureId);
    if (target) {
      goTo(target);
    } else {
      getCapture(projectId!, h.targetCaptureId).then((c) => {
        if (c.locationId && c.locationId !== locationId) {
          navigate(`/projects/${projectId}/buildlens/${c.locationId}`);
        }
      });
    }
  }

  // Auto-advance while playing. Re-runs (and reschedules) on every step, on
  // every speed change, and on pause/resume -- so changing speed mid-play
  // takes effect on the very next tick without a stop/restart, and resuming
  // from pause continues from `active`, not from the start.
  useEffect(() => {
    if (!isPlaying || !active || captures.length === 0) return;
    const idx = captures.findIndex((c) => c.id === active.id);
    if (idx < 0 || idx >= captures.length - 1) {
      setIsPlaying(false); // reached the last capture -- stop rather than loop silently
      return;
    }
    const timer = setTimeout(() => {
      const incoming = captures[idx + 1];
      setCurrentYaw((prevYaw) => computeContinuationYaw(prevYaw, active.compassHeadingDeg, incoming.compassHeadingDeg));
      setActiveCaptureId(incoming.id);
    }, BASE_STEP_MS / speed);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, speed, active?.id, captures]);

  const dateMutation = useMutation({
    mutationFn: () => updateCapture(projectId!, active!.id, { capturedAt: new Date(dateBuffer).toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['viewer', projectId, locationId] });
      setEditingDate(false);
    },
  });

  if (!projectId || !locationId) return null;

  return (
    <>
      <PageHeader
        eyebrow={locationLabel ?? 'BuildLens'}
        title="Timeline"
        actions={
          <>
            <Link to={`/projects/${projectId}/buildlens`} className="btn-ghost text-xs">
              <BackIcon className="w-3.5 h-3.5" /> All locations
            </Link>
            <button onClick={() => setCompareMode((v) => !v)} className={compareMode ? 'btn-primary' : 'btn-secondary'}>
              <CompareIcon className="w-4 h-4" /> Compare
            </button>
            <button onClick={() => setUploadOpen(true)} className="btn-primary">
              <UploadIcon className="w-4 h-4" /> Upload capture
            </button>
          </>
        }
      />

      <div className="p-6 space-y-4">
        {viewerQuery.isLoading && (
          <div className="text-sm text-ink-500">Loading captures for this location…</div>
        )}

        {viewerQuery.isSuccess && captures.length === 0 && (
          <div className="panel p-8 text-center text-sm text-ink-500">
            No 360° captures registered at this location yet.
          </div>
        )}

        {captures.length > 0 && !compareMode && (
          <>
            <div className="relative h-[62vh] panel overflow-hidden">
              {imageUrl && (
                <ThreeJsViewer
                  imageUrl={imageUrl}
                  hotspots={hotspots}
                  onHotspotClick={handleHotspotClick}
                  initialYaw={currentYaw}
                />
              )}
            </div>

            <div className="panel p-4 space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIsPlaying((v) => !v)}
                    className="btn-primary !px-3 !py-1.5"
                    disabled={captures.length < 2}
                  >
                    {isPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
                    {isPlaying ? 'Pause' : 'Play'}
                  </button>
                  <div className="flex items-center gap-1">
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        onClick={() => setSpeed(s)}
                        className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                          speed === s ? 'bg-signal/15 text-signal' : 'text-ink-500 hover:text-ink-100 hover:bg-base-800'
                        }`}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{active ? formatDate(active.capturedAt) : ''}</span>
                  {active && !editingDate && (
                    <button onClick={() => setEditingDate(true)} className="text-ink-500 hover:text-blueprint" title="Edit capture date">
                      <EditIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {active && editingDate && (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        type="datetime-local"
                        className="field-input !py-1 !text-xs w-auto"
                        value={dateBuffer}
                        onChange={(e) => setDateBuffer(e.target.value)}
                      />
                      <button onClick={() => dateMutation.mutate()} disabled={dateMutation.isPending} className="btn-primary !px-2 !py-1 text-xs shrink-0">
                        Save
                      </button>
                      <button
                        onClick={() => { setDateBuffer(toDatetimeLocalValue(active.capturedAt)); setEditingDate(false); }}
                        className="btn-ghost !px-1.5 !py-1 text-xs shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-0 overflow-x-auto pb-1">
                <div className="relative flex items-center min-w-full" style={{ minWidth: `${Math.max(captures.length * 90, 100)}px` }}>
                  <div className="absolute left-0 right-0 top-1/2 h-px bg-base-600 -translate-y-1/2" />
                  {captures.map((c) => {
                    const isActive = c.id === active?.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => goTo(c)}
                        className="relative flex flex-col items-center gap-1.5 flex-1 min-w-[80px] group"
                      >
                        <span
                          className={`w-3 h-3 rounded-full border-2 transition-colors ${
                            isActive ? 'bg-signal border-signal' : 'bg-base-900 border-base-500 group-hover:border-blueprint'
                          }`}
                        />
                        <span className={`text-[10px] font-mono whitespace-nowrap ${isActive ? 'text-signal' : 'text-ink-500'}`}>
                          {formatDate(c.capturedAt)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {captures.length > 0 && compareMode && (
          <CompareView
            captures={captures}
            leftId={compareLeftId}
            rightId={compareRightId}
            onLeftChange={setCompareLeftId}
            onRightChange={setCompareRightId}
          />
        )}
      </div>

      <CaptureUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        projectId={projectId}
        locations={currentLocation ? [currentLocation] : []}
        defaultLocationId={locationId}
      />
    </>
  );
}

function CompareView({
  captures,
  leftId,
  rightId,
  onLeftChange,
  onRightChange,
}: {
  captures: Capture[];
  leftId: string;
  rightId: string;
  onLeftChange: (id: string) => void;
  onRightChange: (id: string) => void;
}) {
  const left = captures.find((c) => c.id === leftId);
  const right = captures.find((c) => c.id === rightId);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[
        { capture: left, value: leftId, onChange: onLeftChange, label: 'Before' },
        { capture: right, value: rightId, onChange: onRightChange, label: 'After' },
      ].map((col, i) => (
        <div key={i} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-widest text-ink-500 w-14 shrink-0">{col.label}</span>
            <select
              className="field-input w-auto flex-1"
              value={col.value}
              onChange={(e) => col.onChange(e.target.value)}
            >
              {captures.map((c) => (
                <option key={c.id} value={c.id}>{formatDate(c.capturedAt)}</option>
              ))}
            </select>
          </div>
          <div className="relative h-[50vh] panel overflow-hidden">
            {col.capture && (col.capture.previewUrl ?? col.capture.thumbnailUrl) ? (
              <ThreeJsViewer
                imageUrl={(col.capture.previewUrl ?? col.capture.thumbnailUrl)!}
                hotspots={[]}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-ink-500 text-sm">
                No image available.
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function BackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CompareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 3v18M16 3v18" strokeLinecap="round" />
      <path d="M3 8h3M3 16h3M18 8h3M18 16h3" strokeLinecap="round" />
    </svg>
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
function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="none">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="none">
      <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
    </svg>
  );
}
function EditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
