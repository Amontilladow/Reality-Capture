import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import * as OBC from '@thatopen/components';

export interface BimViewerHandle {
  fitToModel: () => void;
  // Resolves false if the guid can't be resolved yet (e.g. the model is
  // still loading) so a caller can retry, rather than silently no-op-ing.
  selectByGuid: (guid: string) => Promise<boolean>;
}

interface BimViewerProps {
  fragmentsUrl: string;
  onSelect?: (guid: string | null) => void;
}

// Core BIM model viewer. Loads a pre-generated Fragments file (never parses
// IFC in the browser — see engineering-review/IFC_ARCHITECTURE_PROPOSAL.md).
// Scope note: this delivers orbit navigation, click-to-select with
// highlight, search-driven selection, and fit-to-model. Walk/first-person
// mode, section planes/box, explode, isolation, hide/show, transparency,
// and storey/discipline/category filters are real, separately-scoped
// enhancements on top of this foundation — not implemented here, and not
// silently stubbed either. See MASTER_BACKLOG.md for status.
export const BimViewer = forwardRef<BimViewerHandle, BimViewerProps>(function BimViewer(
  { fragmentsUrl, onSelect },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const worldRef = useRef<OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer> | null>(null);
  const fragmentsRef = useRef<OBC.FragmentsManager | null>(null);
  const modelIdRef = useRef<string>('main');
  const highlightedRef = useRef<OBC.ModelIdMap>({});

  async function clearHighlight() {
    const fragments = fragmentsRef.current;
    if (!fragments || Object.keys(highlightedRef.current).length === 0) return;
    await fragments.resetHighlight(highlightedRef.current);
    highlightedRef.current = {};
  }

  async function highlightModelIdMap(modelIdMap: OBC.ModelIdMap) {
    const fragments = fragmentsRef.current;
    if (!fragments) return;
    await clearHighlight();
    await fragments.highlight({ color: new THREE.Color('#3b82f6'), renderedFaces: 0, opacity: 1, transparent: false }, modelIdMap);
    highlightedRef.current = modelIdMap;
  }

  useImperativeHandle(ref, () => ({
    fitToModel: () => {
      const world = worldRef.current;
      const fragments = fragmentsRef.current;
      if (!world || !fragments) return;
      // world.meshes is never populated by our own loading code (we only add
      // model.object to the scene graph directly), so it's always empty --
      // read the box straight from the loaded model instead, same as the
      // initial-load fit.
      const model = fragments.list.get(modelIdRef.current);
      if (!model) return;
      const box = model.box;
      if (!box.isEmpty()) world.camera.controls.fitToBox(box, true);
    },
    selectByGuid: async (guid: string) => {
      const fragments = fragmentsRef.current;
      if (!fragments) return false;
      const modelIdMap = await fragments.guidsToModelIdMap([guid]);
      if (Object.keys(modelIdMap).length === 0) return false;
      await highlightModelIdMap(modelIdMap);
      return true;
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;

    const components = new OBC.Components();
    const worlds = components.get(OBC.Worlds);
    const world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();
    world.scene = new OBC.SimpleScene(components);
    world.renderer = new OBC.SimpleRenderer(components, container);
    world.camera = new OBC.OrthoPerspectiveCamera(components);
    world.scene.setup();
    world.scene.three.background = null;
    worldRef.current = world;

    // The camera-controls library defaults wheel-zoom to "dolly to cursor":
    // each scroll tick recomputes the orbit target from a ray through the
    // mouse position, not just the camera distance. Confirmed by direct
    // reproduction: once the cursor isn't dead-centered on the model (the
    // normal case for a small/off-center model in a large viewport), this
    // walks the target away from the model within a handful of scroll
    // ticks -- this is "zoom loses the model". Disabling it makes wheel-zoom
    // dolly straight along the current view axis, always toward the target
    // that was last explicitly set (e.g. by fitToBox), regardless of cursor
    // position -- standard, predictable CAD-viewer zoom behavior.
    world.camera.controls.dollyToCursor = false;

    components.init();

    const fragments = components.get(OBC.FragmentsManager);
    fragmentsRef.current = fragments;

    // fragments.raycast() expects `mouse` in raw viewport (clientX/clientY)
    // coordinates -- it does its own `element.getBoundingClientRect()`
    // subtraction internally. Subtracting the container's offset here too,
    // on top of that, double-counts it and sends every ray off by however
    // far the canvas sits from the browser's left/top edge (here: a full
    // sidebar + header's worth) -- effectively never hitting real geometry
    // once the viewer isn't flush against the viewport corner. Pass the
    // raw client coordinates straight through.
    //
    // Thin elements (conduit, cable, rebar) are still only a couple of
    // screen pixels wide even with correct math, so a single raycast can
    // miss them by a pixel -- retry in a small ring around the click point
    // as a cheap fallback (only on an actual miss).
    async function raycastWithTolerance(clientX: number, clientY: number) {
      const offsets: [number, number][] = [
        [0, 0],
        [3, 0], [-3, 0], [0, 3], [0, -3],
        [3, 3], [-3, 3], [3, -3], [-3, -3],
        [6, 0], [-6, 0], [0, 6], [0, -6],
      ];
      for (const [dx, dy] of offsets) {
        const mouse = new THREE.Vector2(clientX + dx, clientY + dy);
        const result = await fragments.raycast({
          camera: world.camera.three,
          mouse,
          dom: world.renderer!.three.domElement,
        });
        if (result) return result;
      }
      return null;
    }

    async function handlePointerClick(event: PointerEvent) {
      if (disposed) return;
      const result = await raycastWithTolerance(event.clientX, event.clientY);

      await clearHighlight();

      if (!result) {
        onSelect?.(null);
        return;
      }

      const modelIdMap: OBC.ModelIdMap = { [result.fragments.modelId]: new Set([result.localId]) };
      await highlightModelIdMap(modelIdMap);

      const guids = await fragments.modelIdMapToGuids(modelIdMap);
      onSelect?.(guids[0] ?? null);
    }

    container.addEventListener('click', handlePointerClick);

    let wheelLogCount = 0;
    function handleWheelDebug(event: WheelEvent) {
      if (disposed || wheelLogCount >= 12) return;
      wheelLogCount++;
      const targetBefore = new THREE.Vector3();
      world.camera.controls.getTarget(targetBefore);
      const posBefore = world.camera.three.position.clone();
      const n = wheelLogCount;
      setTimeout(() => {
        const targetAfter = new THREE.Vector3();
        world.camera.controls.getTarget(targetAfter);
        const posAfter = world.camera.three.position.clone();
        // eslint-disable-next-line no-console
        console.log(`[BIM-DEBUG] wheel #${n}`, {
          deltaY: event.deltaY,
          dollyToCursor: world.camera.controls.dollyToCursor,
          maxDistance: world.camera.controls.maxDistance,
          targetBefore: targetBefore.toArray(),
          targetAfter: targetAfter.toArray(),
          targetDelta: targetAfter.distanceTo(targetBefore),
          posBefore: posBefore.toArray(),
          posAfter: posAfter.toArray(),
        });
      }, 250);
    }
    container.addEventListener('wheel', handleWheelDebug);

    async function loadModel() {
      try {
        await fragments.init(await OBC.FragmentsManager.getWorker());

        const response = await fetch(fragmentsUrl);
        if (!response.ok) throw new Error(`Failed to download Fragments file (HTTP ${response.status})`);
        const buffer = await response.arrayBuffer();
        // core.load() resolves directly with the loaded FragmentsModel — use that,
        // rather than waiting on the separate onFragmentsLoaded event, which is not
        // guaranteed to fire for this specific load call.
        const model = await fragments.core.load(buffer, { modelId: modelIdRef.current });

        if (disposed) return;
        world.scene.three.add(model.object);

        // Use the model's own bounding box, not one derived from `model.object`'s
        // mesh children: `@thatopen/fragments` populates those meshes asynchronously
        // (via an internal tile/view-refresh cycle) after core.load() resolves, so
        // setFromObject(model.object) here always reads an empty graph and silently
        // skips the fit, leaving the camera at its default position.
        const box = model.box;
        if (!box.isEmpty()) {
          world.camera.controls.fitToBox(box, false);
          // The camera-controls library's default maxDistance (300) is fixed and
          // unrelated to this model's actual scale. Dollying out past it triggers
          // a bug where the orbit target itself jumps to a wrong, faraway point
          // instead of the distance simply being clamped -- confirmed by direct
          // reproduction: with the default limit, repeated zoom-out eventually
          // snaps the target dozens of units away from the model ("zoom loses the
          // model"); raising the limit well beyond normal use avoids ever hitting
          // that path. Scale it to the model's own size so small and large models
          // both get generous, but bounded, zoom-out room.
          const modelSize = box.getSize(new THREE.Vector3()).length();
          world.camera.controls.maxDistance = Math.max(1000, modelSize * 50);
        }
        setLoading(false);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : 'Failed to load model');
        setLoading(false);
      }
    }
    loadModel();

    return () => {
      disposed = true;
      container.removeEventListener('click', handlePointerClick);
      container.removeEventListener('wheel', handleWheelDebug);
      components.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fragmentsUrl]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-gray-600">
          Loading model…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/90 text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  );
});
