import { NotificationEmailProcessor } from './notification-email.processor';
import type { DatabaseService } from '../../../database/database.service';
import type { EmailService } from '../../email/email.service';

function makeJob(data: { companyId: string; deliveryId: string }) {
  return { data } as unknown as Parameters<NotificationEmailProcessor['handleDeliver']>[0];
}

describe('NotificationEmailProcessor', () => {
  const row = {
    id: 'delivery-1', toEmail: 'user1@example.com', title: 'RFI overdue',
    body: 'RFI-0012 is overdue.', category: 'rfi', priority: 'high', actionRequired: true,
  };

  it('sends the rendered notification email and marks the delivery delivered', async () => {
    const withTenant = jest.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const db = { withTenant };
    const send = jest.fn().mockResolvedValue(undefined);
    const email = { send };

    const processor = new NotificationEmailProcessor(db as unknown as DatabaseService, email as unknown as EmailService);
    await processor.handleDeliver(makeJob({ companyId: 'company-1', deliveryId: 'delivery-1' }));

    expect(send).toHaveBeenCalledTimes(1);
    const [to, subject] = send.mock.calls[0] as [string, string, string, string];
    expect(to).toBe('user1@example.com');
    expect(subject).toContain('RFI overdue');
  });

  it('skips silently when the delivery row no longer exists', async () => {
    const withTenant = jest.fn().mockResolvedValueOnce([]);
    const db = { withTenant };
    const send = jest.fn();
    const email = { send };

    const processor = new NotificationEmailProcessor(db as unknown as DatabaseService, email as unknown as EmailService);
    await expect(processor.handleDeliver(makeJob({ companyId: 'company-1', deliveryId: 'missing' }))).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('marks the delivery failed and re-throws (for Bull to retry) when sending fails', async () => {
    const withTenant = jest.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const db = { withTenant };
    const send = jest.fn().mockRejectedValue(new Error('SMTP connection refused'));
    const email = { send };

    const processor = new NotificationEmailProcessor(db as unknown as DatabaseService, email as unknown as EmailService);
    await expect(processor.handleDeliver(makeJob({ companyId: 'company-1', deliveryId: 'delivery-1' })))
      .rejects.toThrow('SMTP connection refused');
  });
});
