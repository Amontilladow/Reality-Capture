import { createHmac } from 'crypto';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import type { ConfigService } from '@nestjs/config';
import type { DatabaseService } from '../../database/database.service';
import type { Response } from 'express';

function makeConfig(values: Record<string, string>) {
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

function makeRes() {
  const res = { status: jest.fn(), send: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
}

describe('WhatsAppWebhookController', () => {
  describe('verify', () => {
    it('echoes the challenge when the mode and verify token match', () => {
      const controller = new WhatsAppWebhookController(makeConfig({ 'whatsapp.webhookVerifyToken': 'secret-token' }), {} as DatabaseService);
      const res = makeRes();

      controller.verify('subscribe', 'secret-token', 'challenge-123', res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('challenge-123');
    });

    it('rejects when the verify token does not match', () => {
      const controller = new WhatsAppWebhookController(makeConfig({ 'whatsapp.webhookVerifyToken': 'secret-token' }), {} as DatabaseService);
      const res = makeRes();

      controller.verify('subscribe', 'wrong-token', 'challenge-123', res);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('receive', () => {
    it('updates the matching delivery row for a status carrying valid biz_opaque_callback_data', async () => {
      const withTenant = jest.fn().mockResolvedValue([]);
      const db = { withTenant } as unknown as DatabaseService;
      const controller = new WhatsAppWebhookController(makeConfig({}), db); // No app secret configured -> signature check is skipped.

      const payload = {
        entry: [{
          changes: [{
            value: {
              statuses: [{
                id: 'wamid.123',
                status: 'delivered' as const,
                biz_opaque_callback_data: JSON.stringify({ companyId: 'company-1', deliveryId: 'delivery-1' }),
              }],
            },
          }],
        }],
      };

      await controller.receive({ rawBody: Buffer.from('') } as never, undefined, payload);

      expect(withTenant).toHaveBeenCalledTimes(1);
      expect(withTenant.mock.calls[0][0]).toBe('company-1');
    });

    it('ignores a status with no biz_opaque_callback_data', async () => {
      const withTenant = jest.fn();
      const db = { withTenant } as unknown as DatabaseService;
      const controller = new WhatsAppWebhookController(makeConfig({}), db);

      const payload = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'sent' as const }] } }] }] };
      await controller.receive({ rawBody: Buffer.from('') } as never, undefined, payload);

      expect(withTenant).not.toHaveBeenCalled();
    });

    it('rejects a payload with an invalid signature when an app secret is configured, without updating anything', async () => {
      const withTenant = jest.fn();
      const db = { withTenant } as unknown as DatabaseService;
      const controller = new WhatsAppWebhookController(makeConfig({ 'whatsapp.appSecret': 'app-secret' }), db);

      const payload = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'sent' as const, biz_opaque_callback_data: JSON.stringify({ companyId: 'c', deliveryId: 'd' }) }] } }] }] };
      await controller.receive({ rawBody: Buffer.from('irrelevant') } as never, 'sha256=bogus', payload);

      expect(withTenant).not.toHaveBeenCalled();
    });

    it('accepts a payload whose signature matches the configured app secret', async () => {
      const withTenant = jest.fn().mockResolvedValue([]);
      const db = { withTenant } as unknown as DatabaseService;
      const appSecret = 'app-secret';
      const controller = new WhatsAppWebhookController(makeConfig({ 'whatsapp.appSecret': appSecret }), db);

      const payload = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'sent' as const, biz_opaque_callback_data: JSON.stringify({ companyId: 'c', deliveryId: 'd' }) }] } }] }] };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

      await controller.receive({ rawBody } as never, signature, payload);

      expect(withTenant).toHaveBeenCalledTimes(1);
    });
  });
});
