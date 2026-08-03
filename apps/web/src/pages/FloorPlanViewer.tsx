import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { DrawingViewer } from '../components/drawing/DrawingViewer';
import { DrawingUploadModal } from '../components/drawing/DrawingUploadModal';
import { PinPanel } from '../components/drawing/PinPanel';
import { listDrawings, getDrawing, createPin, getPins, type Pin } from '../lib/drawings.api';
import { getHierarchy, updateLocation } from '../lib/projects.api';

export default function FloorPlanViewer() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [placingMode, setPlacingMode] = useState(false);
  const [movingPin, setMovingPin] = useState<Pin | null>(null);
  const [openPin, setOpenPin] = useState<Pin | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(1);

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

  // Pins carry which page they were placed on; only show the ones for the
  // page currently rendered so a multi-page drawing doesn't overlay every
  // page's pins onto whichever page happens to be visible.
  const pinsForCurrentPage = (pinsQuery.data ?? []).filter((p) => p.pageNumber === currentPage);

  const createPinMutation = useMutation({
    mutationFn: (payload: { xNorm: number; yNorm: number }) =>
      createPin(projectId!, activeDrawingId!, { posXNorm: payload.xNorm, posYNorm: payload.yNorm, pageNumber: currentPage }),
    onSuccess: (pin) => {
      queryClient.invalidateQueries({ queryKey: ['pins', projectId, activeDrawingId] });
      setPlacingMode(false);
      setOpenPin(pin); // jump straight into "add the first photo" for the pin just created
    },
  });

  const moveMutation = useMutation({
    mutationFn: (payload: { xNorm: number; yNorm: number }) =>
      updateLocation(projectId!, movingPin!.locationId, { posXNorm: payload.xNorm, posYNorm: payload.yNorm }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pins', projectId, activeDrawingId] });
      setMovingPin(null);
    },
  });

  function handlePinClick(pin: Pin) {
    if (movingPin) return; // ignore stray clicks on other pins while repositioning
    setOpenPin(pin);
  }

  function handlePlaceClick(x: number, y: number) {
    if (movingPin) moveMutation.mutate({ xNorm: x, yNorm: y });
    else createPinMutation.mutate({ xNorm: x, yNorm: y });
  }

  function goToPage(p: number) {
    setCurrentPage(p);
    setPlacingMode(false);
    setMovingPin(null);
    setOpenPin(null);
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
              onClick={() => { setSelectedDrawingId(d.id); setPlacingMode(false); setMovingPin(null); setCurrentPage(1); setNumPages(1); }}
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
              {movingPin ? (
                <div className="flex items-center gap-2 text-xs text-signal">
                  <span>Click the drawing to move "{movingPin.name || 'Untitled pin'}"</span>
                  <button onClick={() => setMovingPin(null)} className="text-ink-500 hover:text-ink-100">
                    Cancel
                  </button>
                </div>
              ) : !placingMode ? (
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
              {numPages > 1 && (
                <div className="flex items-center gap-1.5 text-xs text-ink-300">
                  <button
                    onClick={() => goToPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage <= 1}
                    className="btn-ghost !px-2 !py-1 disabled:opacity-30"
                  >
                    ← Prev
                  </button>
                  <span className="font-mono">Page {currentPage} of {numPages}</span>
                  <button
                    onClick={() => goToPage(Math.min(numPages, currentPage + 1))}
                    disabled={currentPage >= numPages}
                    className="btn-ghost !px-2 !py-1 disabled:opacity-30"
                  >
                    Next →
                  </button>
                </div>
              )}
              {(pinsQuery.data?.length ?? 0) > 0 && (
                <span className="text-[10px] font-mono text-ink-500 ml-auto">
                  {pinsForCurrentPage.length} pin{pinsForCurrentPage.length === 1 ? '' : 's'}
                  {numPages > 1 ? ` on this page (${pinsQuery.data!.length} total)` : ''}
                </span>
              )}
            </div>
          )}

          {drawingQuery.data && (
            <DrawingViewer
              fileUrl={drawingQuery.data.downloadUrl ?? ''}
              isPdf={Boolean(drawingQuery.data.downloadUrl?.toLowerCase().includes('.pdf'))}
              page={currentPage}
              onNumPages={setNumPages}
              pins={pinsForCurrentPage}
              placingMode={placingMode || Boolean(movingPin)}
              onPlacePin={handlePlaceClick}
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

      <DrawingUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} projectId={projectId} hierarchy={hierarchyQuery.data ?? []} />
      <PinPanel
        projectId={projectId}
        pin={openPin}
        onClose={() => setOpenPin(null)}
        onMove={(pin) => { setOpenPin(null); setPlacingMode(false); setMovingPin(pin); }}
        onDeleted={() => setOpenPin(null)}
      />
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
