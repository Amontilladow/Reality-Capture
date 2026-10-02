import { WebhooksService } from './webhooks.service';
import type { DatabaseService } from '../../database/database.service';
import type { Queue } from 'bull';

describe('WebhooksService.emitEvent', () => {
  it('only ever queries webhook_endpoints scoped to the given companyId, never a cross-tenant lookup', async () => {
    const seenCompanyIds: string[] = [];
    const withTenant = jest.fn(async (companyId: string, fn: (sql: unknown) => unknown) => {
      seenCompanyIds.push(companyId);
      // The SELECT (lookup) call and the INSERT (delivery row) call both
      // flow through this same mock -- the SELECT needs a row back, the
      // INSERT needs sql.json() to exist and needs to resolve to a row
      // with an id so deliveryQueue.add() has something to enqueue.
      const fakeSql = Object.assign(
        (_strings: TemplateStringsArray, ..._values: unknown[]) => [{ id: 'endpoint-1' }],
        { json: (v: unknown) => v },
      );
      return fn(fakeSql as never);
    });
    const db = { withTenant };
    const add = jest.fn().mockResolvedValue(undefined);
    const queue = { add } as unknown as Queue;
    const svc = new WebhooksService(db as unknown as DatabaseService, queue);

    await svc.emitEvent('company-1', 'issue.created', { issue: { id: 'issue-1' } });

    expect(seenCompanyIds.every(id => id === 'company-1')).toBe(true);
    expect(add).toHaveBeenCalledWith('deliver', { companyId: 'company-1', deliveryId: expect.any(String) });
  });

  it('queues nothing when the company has no active endpoints subscribed to the event', async () => {
    const withTenant = jest.fn().mockResolvedValue([]);
    const db = { withTenant };
    const add = jest.fn();
    const svc = new WebhooksService(db as unknown as DatabaseService, { add } as unknown as Queue);

    await svc.emitEvent('company-1', 'capture.uploaded', {});

    expect(add).not.toHaveBeenCalled();
  });

  it('never throws into the caller even if the lookup itself fails', async () => {
    const withTenant = jest.fn().mockRejectedValue(new Error('db down'));
    const db = { withTenant };
    const svc = new WebhooksService(db as unknown as DatabaseService, { add: jest.fn() } as unknown as Queue);

    await expect(svc.emitEvent('company-1', 'issue.created', {})).resolves.toBeUndefined();
  });
});
