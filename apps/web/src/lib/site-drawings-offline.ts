// Client-side storage for explicitly downloaded offline drawing packages
// (brief section 8). The PDF bytes live here, in the browser's own
// IndexedDB, never in Postgres (see SiteDrawingOfflinePackage's own
// comment in site-drawing.types.ts) — this module owns exactly that, plus
// the integrity hash used to detect a corrupted/partial download. No new
// dependency: a single object store doesn't need the `idb` package, just
// the raw IndexedDB API wrapped in promises.
const DB_NAME = 'rc-site-drawings-offline';
const DB_VERSION = 1;
const STORE_NAME = 'packages';

export interface StoredOfflinePackage {
  packageId: string;
  revisionId: string;
  drawingId: string;
  blob: Blob;
  contentHash: string;
  fileSizeBytes: number;
  storedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'packageId' });
        store.createIndex('revisionId', 'revisionId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// SHA-256 over the downloaded bytes -- compared against the content hash
// the server reports for the revision (when it has one) so a partial or
// corrupted download is caught before it's ever presented as a complete
// offline package (brief sections 8/10).
export async function computeContentHash(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function saveOfflinePackage(pkg: Omit<StoredOfflinePackage, 'storedAt'>): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ ...pkg, storedAt: new Date().toISOString() } satisfies StoredOfflinePackage);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getOfflinePackage(packageId: string): Promise<StoredOfflinePackage | null> {
  const db = await openDb();
  const result = await new Promise<StoredOfflinePackage | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(packageId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export async function deleteOfflinePackage(packageId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(packageId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// Every locally stored package's id -- used to reconcile against the
// server's own package list (a package the server no longer knows about,
// e.g. after a policy change, should be cleared locally too) and for the
// sign-out clear-all below.
export async function listStoredPackageIds(): Promise<string[]> {
  const db = await openDb();
  const result = await new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

// Clears every offline package's bytes from this browser (brief section 9:
// "Clear locally cached protected data when the user signs out"). Called
// from the auth store's own sign-out path — see auth.store.ts.
export async function clearAllOfflinePackages(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
