import { createHmac } from 'crypto';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import type { DatabaseService } from '../../../database/database.service';

function makeJob(data: { companyId: string; deliveryId: string }) {
  return { data } as unknown as Parameters<WebhookDeliveryProcessor['handleDeliver']>[0];
}

describe('WebhookDeliveryProcessor', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('signs the exact POST body with HMAC-SHA256 of the endpoint secret, in the X-Webhook-Signature header', async () => {
    const delivery = { id: 'delivery-1', eventType: 'issue.created', payload: { issue: { id: 'issue-1' } }, url: 'https://example.invalid/hook', secret: 'topsecret' };
    const withTenant = jest.fn()
      .mockResolvedValueOnce([delivery]) // SELECT join
      .mockResolvedValueOnce([]);        // UPDATE after success
    const db = { withTenant };

    let capturedInit: RequestInit | undefined;
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const processor = new WebhookDeliveryProcessor(db as unknown as DatabaseService);
    await processor.handleDeliver(makeJob({ companyId: 'company-1', deliveryId: 'delivery-1' }));

    const expectedBody = JSON.stringify({ event: delivery.eventType, data: delivery.payload });
    const expectedSignature = `sha256=${createHmac('sha256', delivery.secret).update(expectedBody).digest('hex')}`;

    expect(capturedInit?.body).toBe(expectedBody);
    expect((capturedInit?.headers as Record<string, string>)['X-Webhook-Signature']).toBe(expectedSignature);
    expect((capturedInit?.headers as Record<string, string>)['X-Webhook-Event']).toBe('issue.created');
  });

  it('marks the delivery delivered on a 2xx response', async () => {
    const delivery = { id: 'delivery-1', eventType: 'capture.uploaded', payload: {}, url: 'https://example.invalid/hook', secret: 's' };
    let updateValues: unknown[] | undefined;
    const withTenant = jest.fn()
      .mockResolvedValueOnce([delivery])
      .mockImplementationOnce(async (_companyId: string, fn: (sql: unknown) => unknown) => {
        const fakeSql = (_strings: TemplateStringsArray, ...values: unknown[]) => { updateValues = values; return []; };
        return fn(fakeSql);
      });
    const db = { withTenant };
    global.fetch = jest.fn().mockResolvedValue(new Response('ok', { status: 200 })) as unknown as typeof fetch;

    const processor = new WebhookDeliveryProcessor(db as unknown as DatabaseService);
    await expect(processor.handleDeliver(makeJob({ companyId: 'company-1', deliveryId: 'delivery-1' }))).resolves.toBeUndefined();

    expect(updateValues).toContain('delivered');
    expect(updateValues).toContain(200);
  });

  it('marks the delivery failed and re-throws (for Bull to retry) on a non-2xx response', async () => {
    const delivery = { id: 'delivery-1', eventType: 'issue.status_changed', payload: {}, url: 'https://example.invalid/hook', secret: 's' };
    const withTenant = jest.fn()
      .mockResolvedValueOnce([delivery])
      .mockResolvedValueOnce([]);
    const db = { withTenant };
    global.fetch = jest.fn().mockResolvedValue(new Response('error', { status: 500 })) as unknown as typeof fetch;

    const processor = new WebhookDeliveryProcessor(db as unknown as DatabaseService);
    await expect(processor.handleDeliver(makeJob({ companyId: 'company-1', deliveryId: 'delivery-1' })))
      .rejects.toThrow('Webhook endpoint responded 500');
  });

  it('marks the delivery failed and re-throws when the endpoint is unreachable', async () => {
    const delivery = { id: 'delivery-1', eventType: 'issue.created', payload: {}, url: 'https://example.invalid/hook', secret: 's' };
    const withTenant = jest.fn()
      .mockResolvedValueOnce([delivery])
      .mockResolvedValueOnce([]);
    const db = { withTenant };
    global.fetch = jest.fn().mockRejectedValue(new Error('network unreachable')) as unknown as typeof fetch;

    const processor = new WebhookDeliveryProcessor(db as unknown as DatabaseService);
    await expect(processor.handleDeliver(makeJob({ companyId: 'company-1', deliveryId: 'delivery-1' })))
      .rejects.toThrow('network unreachable');
  });
});
