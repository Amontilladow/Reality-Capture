import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { DrawingViewer } from '../components/drawing/DrawingViewer';
import { DrawingUploadModal } from '../components/drawing/DrawingUploadModal';
import { PinPanel } from '../components/drawing/PinPanel';
import { listDrawings, getDrawing, createPin, getPins, type Pin } from '../lib/drawings.api';
import { getHierarchy } from '../lib/projects.api';

export default function FloorPlanViewer() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [placingMode, setPlacingMode] = useState(false);
  const [openPin, setOpenPin] = useState<Pin | null>(null);

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

  const drawingQuery = useQuery({
    queryKey: ['drawing', projectId, activeDrawingId],
    queryFn: () => getDrawing(projectId!, activeDrawingId!),
    enabled: Boolean(projectId && activeDrawingId),
  });

  const pinsQuery = useQuery({
    queryKey: ['pins', projectId, activeDrawingId],
    queryFn: () => getPins(projectId!, activeDrawingId!),
    enabled: Boolean(projectId && activeDrawingId),
  });

  const createPinMutation = useMutation({
    mutationFn: (payload: { xNorm: number; yNorm: number }) =>
      createPin(projectId!, activeDrawingId!, { posXNorm: payload.xNorm, posYNorm: payload.yNorm }),
    onSuccess: (pin) => {
      queryClient.invalidateQueries({ queryKey: ['pins', projectId, activeDrawingId] });
      setPlacingMode(false);
      setOpenPin(pin); // jump straight into "add the first photo" for the pin just created
    },
  });

  const allLevels = (hierarchyQuery.data ?? []).flatMap((b) => b.levels ?? []);

  function handlePinClick(pin: Pin) {
    setOpenPin(pin);
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
              onClick={() => { setSelectedDrawingId(d.id); setPlacingMode(false); }}
              className={`w-full text-left px-3 py-2.5 rounded text-sm transition-colors ${
                activeDrawingId === d.id ? 'bg-signal/10 text-signal' : 'text-ink-300 hover:bg-base-800'
              }`}
            >
              <div className="font-medium truncate">{d.title}</div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 space-y-3">
          {activeDrawingId && (
            <div className="flex items-center gap-3">
              {!placingMode ? (
                <button onClick={() => setPlacingMode(true)} className="btn-secondary text-xs !py-1.5">
                  + Add pin
                </button>
              ) : (
                <div className="flex items-center gap-2 text-xs text-signal">
                  <span>Click on the drawing to drop a pin</span>
                  <button onClick={() => setPlacingMode(false)} className="text-ink-500 hover:text-ink-100">
                    Cancel
                  </button>
                </div>
              )}
              {(pinsQuery.data?.length ?? 0) > 0 && (
                <span className="text-[10px] font-mono text-ink-500 ml-auto">
                  {pinsQuery.data!.length} pin{pinsQuery.data!.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
          )}

          {drawingQuery.data && (
            <DrawingViewer
              fileUrl={drawingQuery.data.downloadUrl ?? ''}
              isPdf={Boolean(drawingQuery.data.downloadUrl?.toLowerCase().includes('.pdf'))}
              pins={pinsQuery.data ?? []}
              placingMode={placingMode}
              onPlacePin={(x, y) => createPinMutation.mutate({ xNorm: x, yNorm: y })}
              onPinClick={handlePinClick}
            />
          )}

          {!activeDrawingId && !drawingsQuery.isLoading && (
            <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
              Upload a floor plan PDF, then click "Add pin" and tap the drawing to mark a spot.
            </div>
          )}
        </div>
      </div>

      <DrawingUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} projectId={projectId} levels={allLevels} />
      <PinPanel projectId={projectId} pin={openPin} onClose={() => setOpenPin(null)} />
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
