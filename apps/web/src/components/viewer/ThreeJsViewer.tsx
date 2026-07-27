import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { Hotspot } from '@engineeringos/types';

interface ScreenHotspot extends Hotspot {
  screenX: number;
  screenY: number;
  visible: boolean;
}

export function ThreeJsViewer({
  imageUrl,
  hotspots,
  onHotspotClick,
}: {
  imageUrl: string;
  hotspots: Hotspot[];
  onHotspotClick?: (hotspot: Hotspot) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [screenHotspots, setScreenHotspots] = useState<ScreenHotspot[]>([]);
  const [loading, setLoading] = useState(true);

  // Mutable interaction state kept outside React render cycle for performance.
  const state = useRef({ lon: 0, lat: 0, onPointerDownLon: 0, onPointerDownLat: 0, onPointerDownX: 0, onPointerDownY: 0, isDown: false });

  const resetView = useCallback(() => {
    state.current.lon = 0;
    state.current.lat = 0;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let width = container.clientWidth;
    let height = container.clientHeight;

    const camera = new THREE.PerspectiveCamera(75, width / height, 1, 1100);
    const scene = new THREE.Scene();

    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1); // view from inside

    const material = new THREE.MeshBasicMaterial({ color: 0x182631 });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const loader = new THREE.TextureLoader();
    loader.load(imageUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      material.needsUpdate = true;
      setLoading(false);
    });

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    function onPointerDown(e: PointerEvent) {
      state.current.isDown = true;
      state.current.onPointerDownX = e.clientX;
      state.current.onPointerDownY = e.clientY;
      state.current.onPointerDownLon = state.current.lon;
      state.current.onPointerDownLat = state.current.lat;
    }
    function onPointerMove(e: PointerEvent) {
      if (!state.current.isDown) return;
      state.current.lon = (state.current.onPointerDownX - e.clientX) * 0.15 + state.current.onPointerDownLon;
      state.current.lat = (e.clientY - state.current.onPointerDownY) * 0.15 + state.current.onPointerDownLat;
    }
    function onPointerUp() {
      state.current.isDown = false;
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.04, 20, 100);
      camera.updateProjectionMatrix();
    }
    function onResize() {
      if (!container) return;
      width = container.clientWidth;
      height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);

    const target = new THREE.Vector3();
    const hotspotVec = new THREE.Vector3();

    function hotspotToVector3(yawDeg: number, pitchDeg: number, radius: number) {
      const phi = THREE.MathUtils.degToRad(90 - pitchDeg);
      const theta = THREE.MathUtils.degToRad(yawDeg);
      return new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      );
    }

    let raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);

      state.current.lat = Math.max(-85, Math.min(85, state.current.lat));
      const phi = THREE.MathUtils.degToRad(90 - state.current.lat);
      const theta = THREE.MathUtils.degToRad(state.current.lon);

      target.x = 500 * Math.sin(phi) * Math.cos(theta);
      target.y = 500 * Math.cos(phi);
      target.z = 500 * Math.sin(phi) * Math.sin(theta);
      camera.lookAt(target);

      renderer.render(scene, camera);

      // Project hotspots to screen space each frame.
      if (hotspots.length > 0) {
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        const next: ScreenHotspot[] = hotspots.map((h) => {
          hotspotVec.copy(hotspotToVector3(h.yawDeg, h.pitchDeg, 480));
          const behind = hotspotVec.clone().normalize().dot(camDir) < 0.15;
          const projected = hotspotVec.clone().project(camera);
          return {
            ...h,
            screenX: ((projected.x + 1) / 2) * width,
            screenY: ((1 - projected.y) / 2) * height,
            visible: !behind && projected.z < 1,
          };
        });
        setScreenHotspots(next);
      }
    }
    animate();

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      geometry.dispose();
      material.dispose();
      material.map?.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  return (
    <div className="relative w-full h-full bg-base-900 overflow-hidden select-none" ref={containerRef}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-ink-500 text-sm">
          Loading panorama…
        </div>
      )}

      {screenHotspots.filter((h) => h.visible).map((h) => (
        <button
          key={h.id}
          onClick={() => onHotspotClick?.(h)}
          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 group"
          style={{ left: h.screenX, top: h.screenY }}
        >
          <span
            className={`w-8 h-8 rounded-full border-2 flex items-center justify-center backdrop-blur transition-transform group-hover:scale-110 ${
              h.hotspotType === 'navigation'
                ? 'bg-signal/90 border-signal-hover'
                : h.hotspotType === 'issue'
                  ? 'bg-danger/80 border-danger'
                  : 'bg-blueprint/80 border-blueprint-hover'
            }`}
          >
            {h.hotspotType === 'navigation' ? (
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-base-950" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-base-950" />
            )}
          </span>
          {h.label && (
            <span className="text-[10px] font-mono bg-base-950/90 text-ink-100 px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
              {h.label}
            </span>
          )}
        </button>
      ))}

      <button
        onClick={resetView}
        className="absolute bottom-4 right-4 btn-secondary !py-1.5 !px-3 text-xs"
        title="Reset view"
      >
        Reset view
      </button>
    </div>
  );
}
