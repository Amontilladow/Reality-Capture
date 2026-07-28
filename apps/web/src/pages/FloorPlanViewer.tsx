import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { DrawingViewer } from '../components/drawing/DrawingViewer';
import { DrawingUploadModal } from '../components/drawing/DrawingUploadModal';
import { listDrawings, getFloorPlanData, linkCaptureToDrawing, type FloorPlanPin } from '../lib/drawings.api';
import { getHierarchy } from '../lib/projects.api';
import { listCaptures } from '../lib/captures.api';

export default function FloorPlanViewer() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkingCaptureId, setLinkingCaptureId] = useState('');
  const [placingMode, setPlacingMode] = useState(false);

  const drawingsQuery = useQuery({
    queryKey: ['drawings', projectId],
    queryFn: () => listDrawings(projectId!),
    enabled: Boolean(projectId),
  });

  const hierarchyQuery = useQuery({
    queryKey: ['hierarchy', projectId],
    queryFn: () => getHierarchy(projectId!),
    enabled: Boolean(projectId),
  });

  const activeDrawingId = selectedDrawingId ?? drawingsQuery.data?.[0]?.id ?? null;

  const floorPlanQuery = useQuery({
    queryKey: ['floor-plan', projectId, activeDrawingId],
    queryFn: () => getFloorPlanData(projectId!, activeDrawingId!),
    enabled: Boolean(projectId && activeDrawingId),
  });

  const unlinkedCapturesQuery = useQuery({
    queryKey: ['captures', projectId, 'unlinked-for-plan'],
    queryFn: () => listCaptures(projectId!, { perPage: 100 }),
    // Must be available to populate the "select a capture" dropdown, which is
    // shown BEFORE placing mode starts (the user picks a capture from this
    // list, then clicks "Place pin" to enter placing mode) -- gating this on
    // placingMode meant the dropdown could never have options in the first
    // place, since placing mode can only start after picking from it.
    enabled: Boolean(projectId),
  });

  const linkMutation = useMutation({
    mutationFn: (payload: { xNorm: number; yNorm: number }) =>
      linkCaptureToDrawing(projectId!, activeDrawingId!, {
        captureId: linkingCaptureId,
        posXNorm: payload.xNorm,
        posYNorm: payload.yNorm,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['floor-plan', projectId, activeDrawingId] });
      setPlacingMode(false);
      setLinkingCaptureId('');
    },
  });

  const allLevels = (hierarchyQuery.data ?? []).flatMap((b) => b.levels ?? []);
  const unlinkedCaptureOptions = unlinkedCapturesQuery.data?.data ?? [];

  function handlePinClick(pin: FloorPlanPin) {
    navigate(`/projects/${projectId}/viewer/${pin.locationId}`);
  }

  if (!projectId) return null;

  return (
    <>
      <PageHeader
        eyebrow="Project"
        title="Floor plans"
        actions={
          <button onClick={() => setUploadOpen(true)} className="btn-primary">
            <UploadIcon /> Upload plan
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 p-6">
        <div className="lg:col-span-1 space-y-1">
          {drawingsQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}
          {drawingsQuery.isSuccess && (drawingsQuery.data ?? []).length === 0 && (
            <div className="tick-frame panel p-6 text-center text-sm text-ink-500">
              No floor plans uploaded yet.
            </div>
          )}
          {(drawingsQuery.data ?? []).map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDrawingId(d.id)}
              className={`w-full text-left px-3 py-2.5 rounded text-sm transition-colors ${
                activeDrawingId === d.id ? 'bg-signal/10 text-signal' : 'text-ink-300 hover:bg-base-800'
              }`}
            >
              <div className="font-medium truncate">{d.title}</div>
              <div className="text-[10px] font-mono text-ink-500">{d.linkedCaptureCount ?? 0} pins</div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 space-y-3">
          {activeDrawingId && (
            <div className="flex items-center gap-3">
              {!placingMode ? (
                <>
                  <select
                    className="field-input w-auto text-xs"
                    value={linkingCaptureId}
                    onChange={(e) => setLinkingCaptureId(e.target.value)}
                  >
                    <option value="">Select a capture to place…</option>
                    {unlinkedCaptureOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.title ?? c.id.slice(0, 8)}</option>
                    ))}
                  </select>
                  <button
                    disabled={!linkingCaptureId}
                    onClick={() => setPlacingMode(true)}
                    className="btn-secondary text-xs !py-1.5"
                  >
                    Place pin
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2 text-xs text-signal">
                  <span>Click on the drawing to place the pin</span>
                  <button onClick={() => setPlacingMode(false)} className="text-ink-500 hover:text-ink-100">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {floorPlanQuery.data && (
            <DrawingViewer
              fileUrl={floorPlanQuery.data.drawing.downloadUrl ?? ''}
              isPdf={Boolean(floorPlanQuery.data.drawing.downloadUrl?.toLowerCase().includes('.pdf'))}
              pins={floorPlanQuery.data.pins ?? []}
              placingMode={placingMode}
              onPlacePin={(x, y) => linkMutation.mutate({ xNorm: x, yNorm: y })}
              onPinClick={handlePinClick}
            />
          )}

          {!activeDrawingId && !drawingsQuery.isLoading && (
            <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
              Upload a floor plan PDF to start placing capture pins.
            </div>
          )}
        </div>
      </div>

      <DrawingUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} projectId={projectId} levels={allLevels} />
    </>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 16V4M7 9l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" strokeLinecap="round" />
    </svg>
  );
}
