import { readQueue, removeFromQueue } from './queue.js';
import type { IngestActivityItem } from './types.js';
import type { IngestResult } from './api-client.js';

// Sends up to 500 queued items (the ingestion DTO's own batch cap) and
// only removes them from the queue after a confirmed successful response.
// If `ingest` throws (network error, 5xx, etc.), execution stops before
// removeFromQueue runs -- the queue is untouched and the same items are
// retried on the next flush cycle. Returns null when there was nothing to
// flush, so the caller can skip logging a no-op cycle.
export async function flushQueue(
  queuePath: string,
  ingest: (items: IngestActivityItem[]) => Promise<IngestResult>,
): Promise<IngestResult | null> {
  const items = readQueue(queuePath).slice(0, 500);
  if (items.length === 0) return null;

  const result = await ingest(items);
  removeFromQueue(queuePath, items.length);
  return result;
}
