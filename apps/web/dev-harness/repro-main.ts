import * as THREE from 'three';
import * as OBC from '@thatopen/components';

const logEl = document.getElementById('log')!;
function log(msg: string) {
  console.log(msg);
  logEl.textContent += msg + '\n';
}

async function run() {
  const params = new URLSearchParams(location.search);
  const file = params.get('file') ?? 'true_original';

  const container = document.getElementById('viewer')!;
  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  const world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();
  world.scene = new OBC.SimpleScene(components);
  world.renderer = new OBC.SimpleRenderer(components, container);
  world.camera = new OBC.OrthoPerspectiveCamera(components);
  world.scene.setup();
  components.init();

  const fragments = components.get(OBC.FragmentsManager);
  await fragments.init(await OBC.FragmentsManager.getWorker());

  const response = await fetch(`/repro/${file}.frag?cb=${Date.now()}`, { cache: 'no-store' });
  const buffer = await response.arrayBuffer();
  log(`file=${file} bytes=${buffer.byteLength}`);

  const model = await fragments.core.load(buffer, { modelId: 'scan' });
  world.scene.three.add(model.object);

  const localIds = await model.getLocalIds();
  log(`localIdCount=${localIds.length}`);

  const CHUNK = 500;
  let totalTris = 0;
  const zeroLocalIds: number[] = [];
  let lengthMismatchChunks = 0;
  for (let i = 0; i < localIds.length; i += CHUNK) {
    const chunkIds = localIds.slice(i, i + CHUNK);
    const meshData = await model.getItemsGeometry(chunkIds);
    if (meshData.length !== chunkIds.length) {
      lengthMismatchChunks++;
      if (lengthMismatchChunks <= 3) {
        log(`LENGTH MISMATCH: requested ${chunkIds.length} ids, got ${meshData.length} entries back`);
      }
    }
    for (let j = 0; j < chunkIds.length; j++) {
      const chunks = meshData[j] || [];
      const tris = chunks.reduce((s: number, c: any) => s + (c.indices ? c.indices.length / 3 : 0), 0);
      totalTris += tris;
      if (tris === 0) zeroLocalIds.push(chunkIds[j]);
    }
  }

  log(`totalTris=${totalTris} zeroGeomCount=${zeroLocalIds.length} lengthMismatchChunks=${lengthMismatchChunks}`);
  const sortedZero = [...zeroLocalIds].sort((a, b) => a - b);
  const zeroSetHashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sortedZero.join(',')));
  const zeroSetHash = [...new Uint8Array(zeroSetHashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  log(`zeroLocalIds count=${zeroLocalIds.length} setHash=${zeroSetHash}`);

  // Resolve GUIDs for the zero-geometry items, for cross-referencing.
  if (zeroLocalIds.length > 0 && zeroLocalIds.length <= 50) {
    const guids: (string | null)[] = [];
    for (const id of zeroLocalIds) {
      const map = { scan: new Set([id]) };
      const g = await fragments.modelIdMapToGuids(map);
      guids.push(g[0] ?? null);
    }
    log(`zero-geometry GUIDs: ${JSON.stringify(guids)}`);
  }

  log('DONE');
  (window as any).__scanResult = { file, byteLength: buffer.byteLength, localIdCount: localIds.length, totalTris, zeroGeomCount: zeroLocalIds.length, zeroLocalIds };
}

run().catch((e) => {
  console.error(e);
  log('FATAL: ' + (e instanceof Error ? e.message : String(e)));
});
