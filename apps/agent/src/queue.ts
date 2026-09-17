import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { IngestActivityItem } from './types.js';

// A plain append-only JSONL file, one queued activity segment per line.
// Deliberately a bare file, not a database -- this is the offline-first
// queue the ingestion DTO's own docstring says it was built to support
// (brief §31): the agent must not lose activity data because of temporary
// connectivity loss, and a flat file survives a process restart trivially.
export function enqueueActivity(queuePath: string, item: IngestActivityItem): void {
  appendFileSync(queuePath, JSON.stringify(item) + '\n');
}

export function readQueue(queuePath: string): IngestActivityItem[] {
  if (!existsSync(queuePath)) return [];
  return readFileSync(queuePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as IngestActivityItem);
}

// Removes exactly the given number of items from the front of the queue --
// called only after a successful flush of that many items. Never touched
// on a failed flush, so a network error just means "the same items are
// still queued and get retried next cycle."
export function removeFromQueue(queuePath: string, count: number): void {
  const remaining = readQueue(queuePath).slice(count);
  writeFileSync(queuePath, remaining.map(item => JSON.stringify(item)).join('\n') + (remaining.length > 0 ? '\n' : ''));
}
