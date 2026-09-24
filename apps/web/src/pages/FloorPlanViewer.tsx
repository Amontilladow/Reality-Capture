import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { DrawingViewer } from '../components/drawing/DrawingViewer';
import { DrawingUploadModal } from '../components/drawing/DrawingUploadModal';
import { PinPanel } from '../components/drawing/PinPanel';
import { listDrawings, getDrawing, createPin, getPins, type Drawing, type Pin } from '../lib/drawings.api';
import { getHierarchy, updateLocation, getMembers, type ProjectHierarchy } from '../lib/projects.api';

export default function FloorPlanViewer() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  // Deep-link support (e.g. from IssueDetail.tsx's "view on floor plan"
  // link): /projects/:id/drawings?drawingId=X&pinId=Y. drawingId can be
  // read straight into initial state, same as IssuesPage.tsx's own
  // ?issueId= pattern; pinId can't resolve until pinsQuery.data loads --
  // PinPanel needs the full Pin object, not just an id -- so that part is
  // handled by the effect below instead.
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(searchParams.get('drawingId'));
  const [uploadOpen, setUploadOpen] = useState(false);
  const [placingMode, setPlacingMode] = useState(false);
  const [movingPin, setMovingPin] = useState<Pin | null>(null);
  const [openPin, setOpenPin] = useState<Pin | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(1);
  // Who a newly-placed pin's auto-created Issue is assigned to -- lets
  // someone walking a site drop several pins in a row all pre-assigned to
  // the same person, without opening each pin's panel afterward.
  const [newPinAssignee, setNewPinAssignee] = useState('');

  // ── Sidebar grouping/filtering (building → level, plus a title search and
  // an optional drawing-type filter) -- all client-side against the one
  // full listDrawings() fetch below, never re-fetched per filter change.
  const [buildingFilter, setBuildingFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [titleSearch, setTitleSearch] = useState('');

  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => getMembers(projectId!),
    enabled: Boolean(projectId),
  });

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

  const hierarchy = useMemo(() => hierarchyQuery.data ?? [], [hierarchyQuery.data]);

  // Resolves each drawing's building/level from the hierarchy tree by
  // matching drawing.levelId against a level nested under some building --
  // no backend join needed, hierarchy is already fetched on this page.
  // A drawing with no levelId, or one pointing at a level no longer in the
  // tree (deleted level), resolves to {building: undefined, level: undefined}
  // and falls into the "Unassigned" bucket below.
  type DrawingWithLocation = Drawing & {
    _building?: ProjectHierarchy;
    _level?: ProjectHierarchy['levels'][number];
  };
  const drawingsWithLocation = useMemo<DrawingWithLocation[]>(() => {
    return (drawingsQuery.data ?? []).map((d) => {
      if (!d.levelId) return d;
      for (const b of hierarchy) {
        const level = b.levels.find((l) => l.id === d.levelId);
        if (level) return { ...d, _building: b, _level: level };
      }
      return d;
    });
  }, [drawingsQuery.data, hierarchy]);

  const drawingTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of drawingsQuery.data ?? []) {
      if (d.drawingType) set.add(d.drawingType);
    }
    return [...set].sort();
  }, [drawingsQuery.data]);

  const levelOptionsForFilter = useMemo(() => {
    const building = hierarchy.find((b) => b.id === buildingFilter);
    return [...(building?.levels ?? [])].sort((a, b) => a.levelOrder - b.levelOrder);
  }, [hierarchy, buildingFilter]);

  const filteredDrawings = useMemo(() => {
    const search = titleSearch.trim().toLowerCase();
    return drawingsWithLocation.filter((d) => {
      if (buildingFilter && d._building?.id !== buildingFilter) return false;
      if (levelFilter && d.levelId !== levelFilter) return false;
      if (typeFilter && d.drawingType !== typeFilter) return false;
      if (search && !d.title.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [drawingsWithLocation, buildingFilter, levelFilter, typeFilter, titleSearch]);

  // Grouped for render: buildings in hierarchy order (so it's stable as
  // filters change), levels within each building sorted by levelOrder, and
  // anything that didn't resolve to a building in an "Unassigned" bucket at
  // the end -- never hidden, per the ask.
  const groupedDrawings = useMemo(() => {
    const byBuilding = new Map<string, Map<string, { level?: ProjectHierarchy['levels'][number]; drawings: DrawingWithLocation[] }>>();
    const unassigned: DrawingWithLocation[] = [];

    for (const d of filteredDrawings) {
      if (!d._building) {
        unassigned.push(d);
        continue;
      }
      if (!byBuilding.has(d._building.id)) byBuilding.set(d._building.id, new Map());
      const levelMap = byBuilding.get(d._building.id)!;
      const levelKey = d._level?.id ?? '__no-level__';
      if (!levelMap.has(levelKey)) levelMap.set(levelKey, { level: d._level, drawings: [] });
      levelMap.get(levelKey)!.drawings.push(d);
    }

    const buildingGroups = hierarchy
      .filter((b) => byBuilding.has(b.id))
      .map((b) => ({
        building: b,
        levelGroups: [...byBuilding.get(b.id)!.values()].sort(
          (a, b2) => (a.level?.levelOrder ?? Infinity) - (b2.level?.levelOrder ?? Infinity),
        ),
      }));

    return { buildingGroups, unassigned };
  }, [filteredDrawings, hierarchy]);

  function selectDrawing(id: string) {
    setSelectedDrawingId(id);
    setPlacingMode(false);
    setMovingPin(null);
    setCurrentPage(1);
    setNumPages(1);
  }

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

  // Resolves the ?pinId= deep link once this drawing's pins are in, jumps
  // to that pin's page, and opens its panel -- then strips both params so
  // navigating elsewhere and back via the sidebar doesn't keep re-opening
  // the same pin every time.
  useEffect(() => {
    const pinId = searchParams.get('pinId');
    if (!pinId || !pinsQuery.data) return;
    const pin = pinsQuery.data.find((p) => p.locationId === pinId);
    if (!pin) return;
    setCurrentPage(pin.pageNumber);
    setOpenPin(pin);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('pinId');
      next.delete('drawingId');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsQuery.data]);

  const createPinMutation = useMutation({
    mutationFn: (payload: { xNorm: number; yNorm: number }) =>
      createPin(projectId!, activeDrawingId!, {
        posXNorm: payload.xNorm, posYNorm: payload.yNorm, pageNumber: currentPage,
        assignedTo: newPinAssignee || undefined,
      }),
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
        <div className="lg:col-span-1 space-y-3">
          {drawingsQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}
          {drawingsQuery.isSuccess && (drawingsQuery.data ?? []).length === 0 && (
            <div className="tick-frame panel p-6 text-center text-sm text-ink-500">
              No floor plans uploaded yet.
            </div>
          )}

          {(drawingsQuery.data ?? []).length > 0 && (
            <div className="space-y-1.5">
              <input
                className="field-input !py-1.5 !text-xs"
                placeholder="Search by title…"
                value={titleSearch}
                onChange={(e) => setTitleSearch(e.target.value)}
              />
              <select
                className="field-input !py-1.5 !text-xs"
                value={buildingFilter}
                onChange={(e) => { setBuildingFilter(e.target.value); setLevelFilter(''); }}
              >
                <option value="">All buildings</option>
                {hierarchy.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <select
                className="field-input !py-1.5 !text-xs"
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                disabled={!buildingFilter}
              >
                <option value="">{buildingFilter ? 'All levels' : 'Pick a building first'}</option>
                {levelOptionsForFilter.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              {drawingTypeOptions.length > 0 && (
                <select
                  className="field-input !py-1.5 !text-xs"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="">All drawing types</option>
                  {drawingTypeOptions.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {drawingsQuery.isSuccess && (drawingsQuery.data ?? []).length > 0 && filteredDrawings.length === 0 && (
            <div className="text-xs text-ink-500 px-1">No floor plans match these filters.</div>
          )}

          <div className="space-y-2">
            {groupedDrawings.buildingGroups.map(({ building, levelGroups }) => (
              <details key={building.id} open>
                <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-ink-500 px-1 py-1 hover:text-ink-300">
                  {building.name}
                </summary>
                <div className="pl-1 space-y-2 mt-1">
                  {levelGroups.map(({ level, drawings }) => (
                    <div key={level?.id ?? '__no-level__'}>
                      <div className="text-[11px] font-medium text-ink-500 px-2 py-1">
                        {level?.name ?? 'No level'}
                      </div>
                      <div className="space-y-1">
                        {drawings.map((d) => (
                          <DrawingRow key={d.id} drawing={d} active={activeDrawingId === d.id} onSelect={selectDrawing} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))}

            {groupedDrawings.unassigned.length > 0 && (
              <details open>
                <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-ink-500 px-1 py-1 hover:text-ink-300">
                  Unassigned
                </summary>
                <div className="pl-1 space-y-1 mt-1">
                  {groupedDrawings.unassigned.map((d) => (
                    <DrawingRow key={d.id} drawing={d} active={activeDrawingId === d.id} onSelect={selectDrawing} />
                  ))}
                </div>
              </details>
            )}
          </div>
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
              {!movingPin && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-ink-500">New pins assign to</span>
                  <select
                    className="field-input w-auto !py-1 !text-xs"
                    value={newPinAssignee}
                    onChange={(e) => setNewPinAssignee(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {(membersQuery.data ?? []).map((m) => (
                      <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
                    ))}
                  </select>
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
        members={membersQuery.data ?? []}
        onClose={() => setOpenPin(null)}
        onMove={(pin) => { setOpenPin(null); setPlacingMode(false); setMovingPin(pin); }}
        onDeleted={() => setOpenPin(null)}
      />
    </>
  );
}

// Same row markup/behavior as the old flat sidebar's inline .map() -- just
// pulled out so it can be reused under every building/level group and the
// Unassigned bucket without repeating the button/className logic.
function DrawingRow({ drawing, active, onSelect }: { drawing: Drawing; active: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(drawing.id)}
      className={`w-full text-left px-3 py-2.5 rounded text-sm transition-colors ${
        active ? 'bg-signal/10 text-signal' : 'text-ink-300 hover:bg-base-800'
      }`}
    >
      <div className="font-medium truncate">{drawing.title}</div>
    </button>
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
