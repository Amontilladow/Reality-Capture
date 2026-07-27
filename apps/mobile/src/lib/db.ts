import * as SQLite from 'expo-sqlite';

export type QueueStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export interface QueuedCapture {
  id: string; // client-generated UUID — also used as idempotency key server-side
  projectId: string;
  locationId: string | null;
  captureType: 'photo_360' | 'photo_standard' | 'video';
  phase: string | null;
  title: string | null;
  description: string | null;
  localFileUri: string; // file:// path in the app's document directory
  mimeType: string;
  sizeBytes: number;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracyM: number | null;
  compassHeadingDeg: number | null;
  capturedAt: string; // ISO timestamp, set at capture time (not upload time)
  status: QueueStatus;
  attempts: number;
  lastError: string | null;
  remoteCaptureId: string | null; // set once the server has registered it
  createdAt: string;
  updatedAt: string;
}

const db = SQLite.openDatabaseSync('engineeringos.db');

export function initDatabase() {
  db.execSync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS queued_captures (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      location_id TEXT,
      capture_type TEXT NOT NULL,
      phase TEXT,
      title TEXT,
      description TEXT,
      local_file_uri TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      gps_lat REAL,
      gps_lng REAL,
      gps_accuracy_m REAL,
      compass_heading_deg REAL,
      captured_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      remote_capture_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_queued_captures_status ON queued_captures(status);
    CREATE INDEX IF NOT EXISTS idx_queued_captures_project ON queued_captures(project_id);
  `);
}

function rowToQueuedCapture(row: any): QueuedCapture {
  return {
    id: row.id,
    projectId: row.project_id,
    locationId: row.location_id,
    captureType: row.capture_type,
    phase: row.phase,
    title: row.title,
    description: row.description,
    localFileUri: row.local_file_uri,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    gpsLat: row.gps_lat,
    gpsLng: row.gps_lng,
    gpsAccuracyM: row.gps_accuracy_m,
    compassHeadingDeg: row.compass_heading_deg,
    capturedAt: row.captured_at,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    remoteCaptureId: row.remote_capture_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function insertQueuedCapture(item: QueuedCapture) {
  db.runSync(
    `INSERT INTO queued_captures
      (id, project_id, location_id, capture_type, phase, title, description,
       local_file_uri, mime_type, size_bytes, gps_lat, gps_lng, gps_accuracy_m,
       compass_heading_deg, captured_at, status, attempts, last_error, remote_capture_id,
       created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      item.id, item.projectId, item.locationId, item.captureType, item.phase, item.title, item.description,
      item.localFileUri, item.mimeType, item.sizeBytes, item.gpsLat, item.gpsLng, item.gpsAccuracyM,
      item.compassHeadingDeg, item.capturedAt, item.status, item.attempts, item.lastError, item.remoteCaptureId,
      item.createdAt, item.updatedAt,
    ],
  );
}

export function listQueuedCaptures(status?: QueueStatus): QueuedCapture[] {
  const rows = status
    ? db.getAllSync(`SELECT * FROM queued_captures WHERE status = ? ORDER BY created_at DESC`, [status])
    : db.getAllSync(`SELECT * FROM queued_captures ORDER BY created_at DESC`);
  return rows.map(rowToQueuedCapture);
}

export function getQueuedCapture(id: string): QueuedCapture | null {
  const row = db.getFirstSync(`SELECT * FROM queued_captures WHERE id = ?`, [id]);
  return row ? rowToQueuedCapture(row) : null;
}

export function updateQueueStatus(id: string, status: QueueStatus, opts?: { lastError?: string | null; remoteCaptureId?: string | null; incrementAttempts?: boolean }) {
  const now = new Date().toISOString();
  if (opts?.incrementAttempts) {
    db.runSync(
      `UPDATE queued_captures SET status = ?, last_error = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`,
      [status, opts?.lastError ?? null, now, id],
    );
  } else {
    db.runSync(
      `UPDATE queued_captures SET status = ?, last_error = ?, remote_capture_id = COALESCE(?, remote_capture_id), updated_at = ? WHERE id = ?`,
      [status, opts?.lastError ?? null, opts?.remoteCaptureId ?? null, now, id],
    );
  }
}

export function deleteQueuedCapture(id: string) {
  db.runSync(`DELETE FROM queued_captures WHERE id = ?`, [id]);
}

export function countByStatus(): Record<QueueStatus, number> {
  const rows = db.getAllSync(`SELECT status, COUNT(*) as n FROM queued_captures GROUP BY status`) as {
    status: QueueStatus;
    n: number;
  }[];
  const counts: Record<QueueStatus, number> = { pending: 0, uploading: 0, uploaded: 0, failed: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}
