import { WhatsAppService } from './whatsapp.service';
import type { ConfigService } from '@nestjs/config';

function makeConfig(values: Record<string, string>) {
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

const FULLY_CONFIGURED = {
  'whatsapp.businessAccountId': 'waba-1',
  'whatsapp.phoneNumberId': 'phone-1',
  'whatsapp.accessToken': 'token-1',
  'whatsapp.apiVersion': 'v21.0',
  'whatsapp.templateName': 'notification_alert',
  'whatsapp.templateLanguage': 'en_US',
};

describe('WhatsAppService', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('isConfigured', () => {
    it('is true only when every required credential is present', () => {
      expect(new WhatsAppService(makeConfig(FULLY_CONFIGURED)).isConfigured()).toBe(true);
      expect(new WhatsAppService(makeConfig({ ...FULLY_CONFIGURED, 'whatsapp.accessToken': '' })).isConfigured()).toBe(false);
      expect(new WhatsAppService(makeConfig({})).isConfigured()).toBe(false);
    });
  });

  describe('sendTemplateMessage', () => {
    it('throws without attempting any request when not configured', async () => {
      const svc = new WhatsAppService(makeConfig({}));
      global.fetch = jest.fn() as unknown as typeof fetch;

      await expect(svc.sendTemplateMessage('15551234567', 'Title', 'Body', '{}')).rejects.toThrow('not configured');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('posts the template message to the configured phone number id and returns the message id', async () => {
      const svc = new WhatsAppService(makeConfig(FULLY_CONFIGURED));
      let capturedUrl: string | undefined;
      let capturedInit: RequestInit | undefined;
      global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.123' }] }), { status: 200 });
      }) as unknown as typeof fetch;

      const result = await svc.sendTemplateMessage('15551234567', 'RFI overdue', 'RFI-0012 is overdue.', '{"deliveryId":"d1"}');

      expect(result).toEqual({ messageId: 'wamid.123' });
      expect(capturedUrl).toBe('https://graph.facebook.com/v21.0/phone-1/messages');
      expect((capturedInit?.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
      const body = JSON.parse(capturedInit?.body as string);
      expect(body.to).toBe('15551234567');
      expect(body.template.name).toBe('notification_alert');
      expect(body.template.components[0].parameters).toEqual([
        { type: 'text', text: 'RFI overdue' },
        { type: 'text', text: 'RFI-0012 is overdue.' },
      ]);
      expect(body.biz_opaque_callback_data).toBe('{"deliveryId":"d1"}');
    });

    it('throws with the response body on a non-2xx response', async () => {
      const svc = new WhatsAppService(makeConfig(FULLY_CONFIGURED));
      global.fetch = jest.fn().mockResolvedValue(new Response('{"error":"invalid template"}', { status: 400 })) as unknown as typeof fetch;

      await expect(svc.sendTemplateMessage('15551234567', 'Title', 'Body', '{}')).rejects.toThrow('400');
    });

    it('throws when the response is missing a message id', async () => {
      const svc = new WhatsAppService(makeConfig(FULLY_CONFIGURED));
      global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [] }), { status: 200 })) as unknown as typeof fetch;

      await expect(svc.sendTemplateMessage('15551234567', 'Title', 'Body', '{}')).rejects.toThrow('message id');
    });
  });
});
