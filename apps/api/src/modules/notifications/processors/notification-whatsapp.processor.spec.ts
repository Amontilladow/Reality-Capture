import { NotificationWhatsAppProcessor } from './notification-whatsapp.processor';
import type { DatabaseService } from '../../../database/database.service';
import type { WhatsAppService } from '../../whatsapp/whatsapp.service';

function makeJob(data: { companyId: string; deliveryId: string }) {
  return { data } as unknown as Parameters<NotificationWhatsAppProcessor['handleDeliver']>[0];
}

const row = { id: 'wa-delivery-1', toPhone: '15551234567', title: 'Critical issue', body: 'Something urgent happened.' };

describe('NotificationWhatsAppProcessor', () => {
  it('sends the template message and marks the delivery sent with the provider message id', async () => {
    const withTenant = jest.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const db = { withTenant };
    const sendTemplateMessage = jest.fn().mockResolvedValue({ messageId: 'wamid.123' });
    const whatsapp = { isConfigured: jest.fn().mockReturnValue(true), sendTemplateMessage };

    const processor = new NotificationWhatsAppProcessor(db as unknown as DatabaseService, whatsapp as unknown as WhatsAppService);
    await processor.handleDeliver(makeJob({ companyId: 'company-1', deliveryId: 'wa-delivery-1' }));

    expect(sendTemplateMessage).toHaveBeenCalledWith('15551234567', 'Critical issue', 'Something urgent happened.', JSON.stringify({ companyId: 'company-1', deliveryId: 'wa-delivery-1' }));
  });

  it('skips silently when the delivery row no longer exists', async () => {
    const withTenant = jest.fn().mockResolvedValueOnce([]);
    const db = { withTenant };
    const whatsapp = { isConfigured: jest.fn(), sendTemplateMessage: jest.fn() };

    const processor = new NotificationWhatsAppProcessor(db as unknown as DatabaseService, whatsapp as unknown as WhatsAppService);
    await expect(processor.handleDeliver(makeJob({ companyId: 'company-1', deliveryId: 'missing' }))).resolves.toBeUndefined();
    expect(whatsapp.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('marks the delivery skipped_not_configured and does not throw when the channel is not configured', async () => {
    const withTenant = jest.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const db = { withTenant };
    const whatsapp = { isConfigured: jest.fn().mockReturnValue(false), sendTemplateMessage: jest.fn() };

    const processor = new NotificationWhatsAppProcessor(db as unknown as DatabaseService, whatsapp as unknown as WhatsAppService);
    await expect(processor.handleDeliver(makeJob({ companyId: 'company-1', deliveryId: 'wa-delivery-1' }))).resolves.toBeUndefined();
    expect(whatsapp.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('marks the delivery failed and re-throws (for Bull to retry) when sending fails', async () => {
    const withTenant = jest.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const db = { withTenant };
    const whatsapp = { isConfigured: jest.fn().mockReturnValue(true), sendTemplateMessage: jest.fn().mockRejectedValue(new Error('WhatsApp API responded 400: invalid template')) };

    const processor = new NotificationWhatsAppProcessor(db as unknown as DatabaseService, whatsapp as unknown as WhatsAppService);
    await expect(processor.handleDeliver(makeJob({ companyId: 'company-1', deliveryId: 'wa-delivery-1' })))
      .rejects.toThrow('invalid template');
  });
});
