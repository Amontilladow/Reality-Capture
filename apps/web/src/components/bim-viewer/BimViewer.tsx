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
      if (!world) return;
      const box = new THREE.Box3();
      for (const mesh of world.meshes) box.expandByObject(mesh);
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

    components.init();

    const fragments = components.get(OBC.FragmentsManager);
    fragmentsRef.current = fragments;

    async function handlePointerClick(event: PointerEvent) {
      if (disposed) return;
      const mouse = new THREE.Vector2();
      const rect = container!.getBoundingClientRect();
      mouse.x = event.clientX - rect.left;
      mouse.y = event.clientY - rect.top;

      const result = await fragments.raycast({
        camera: world.camera.three,
        mouse,
        dom: world.renderer!.three.domElement,
      });

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
        const box = new THREE.Box3().setFromObject(model.object);
        if (!box.isEmpty()) world.camera.controls.fitToBox(box, false);
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
