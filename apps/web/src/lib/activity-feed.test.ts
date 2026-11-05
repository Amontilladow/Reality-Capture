import { describe, expect, it } from 'vitest';
import { groupActivity } from './activity-feed';
import type { AuditEntry } from './audit.api';

const entry = (id: number, action: string, resourceType: string, userName = 'Sam Okafor', resourceLabel?: string): AuditEntry => ({
  id, userName, action, resourceType, resourceLabel, occurredAt: new Date(Date.now() - id * 60_000).toISOString(),
});

describe('groupActivity', () => {
  it('drops internal pipeline events a reader cannot act on', () => {
    const rows = groupActivity([entry(1, 'jobs.created', 'jobs'), entry(2, 'uploads.created', 'uploads'), entry(3, 'rerun.created', 'rerun'), entry(4, 'auth.login', 'auth')]);
    expect(rows).toEqual([]);
  });

  it('names records the way a site team does', () => {
    const [row] = groupActivity([entry(1, 'issue.created', 'issue', 'Sam Okafor', 'pump room')]);
    expect(row.text).toBe('created issue "pump room"');
  });

  it('merges a run of the same person doing the same thing', () => {
    const rows = groupActivity([
      entry(1, 'snag_item.created', 'snag_item'),
      entry(2, 'snag_item.created', 'snag_item'),
      entry(3, 'snag_item.created', 'snag_item'),
      entry(4, 'rfi.updated', 'rfi'),
    ]);
    expect(rows.map((r) => r.text)).toEqual(['created 3 snags', 'updated RFI']);
  });
});
