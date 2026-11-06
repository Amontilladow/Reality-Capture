import { NotificationsService } from './notifications.service';
import { NotificationEmailProcessor } from './processors/notification-email.processor';
import { NotificationWhatsAppProcessor } from './processors/notification-whatsapp.processor';
import { NotificationEscalationService } from './notification-escalation.service';
import type { DatabaseService } from '../../database/database.service';
import type { NotificationsGateway } from './notifications.gateway';
import type { WhatsAppService } from '../whatsapp/whatsapp.service';
import type { EmailService } from '../email/email.service';
import type { NotificationEmailJobData } from './notification-email.constants';
import type { NotificationWhatsAppJobData } from './notification-whatsapp.constants';

// Phase 5 (master spec section 11): proves the whole engine -- create(),
// preference enforcement, both delivery channels, and escalation --
// actually clicks together as one pipeline, rather than each piece only
// being checked in isolation against a scripted mock (as every other
// *.spec.ts in this module does). The only things mocked here are the two
// genuine external-I/O boundaries (SMTP via EmailService.send, Meta's API
// via WhatsAppService.sendTemplateMessage/isConfigured) and the Socket.io
// push (NotificationsGateway.emitToUser) -- everything else is the real
// NotificationsService/NotificationEmailProcessor/
// NotificationWhatsAppProcessor/NotificationEscalationService, run against
// a small in-memory fake standing in for Postgres: real enough to prove
// the data actually flows end to end (a row this test asserts on was
// written by the real INSERT text in the real service, not fabricated by
// the test itself).
//
// The fake's `sql` dispatcher matches each call by a literal substring
// unique to that query (same substring-matching convention
// issue-scheduled-reminders.service.spec.ts's own makeQuery() helper
// uses), then finds the row(s) it needs by looking for a value in the
// interpolated args that's an existing id in the relevant collection --
// deliberately position-independent, so it doesn't silently break if a
// query's own column order changes without its behavior changing.
class FakeDb {
  seq = 0;
  users = new Map<string, Record<string, unknown>>();
  notifications: Record<string, unknown>[] = [];
  emailDeliveries: Record<string, unknown>[] = [];
  whatsappDeliveries: Record<string, unknown>[] = [];
  managerOf = new Map<string, string>();

  private nextId(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }

  async withTenant<T>(_companyId: string, fn: (sql: unknown) => T | Promise<T>): Promise<T> {
    return fn(this.makeSql());
  }

  async withSystemBypass<T>(fn: (sql: unknown) => T | Promise<T>): Promise<T> {
    return fn(this.makeSql());
  }

  private makeSql() {
    const call = (strings: TemplateStringsArray, ...values: unknown[]) => this.dispatch(strings.join('?'), values);
    return Object.assign(call, { json: (v: unknown) => v });
  }

  private findId(values: unknown[], has: (id: string) => boolean): string | undefined {
    return values.find((v): v is string => typeof v === 'string' && has(v));
  }

  private dispatch(text: string, values: unknown[]): Promise<Record<string, unknown>[]> {
    if (text.includes('INSERT INTO notifications')) {
      const [companyId, userId, type, title, body, resourceType, resourceId, projectId, createdBy, category, priority, actionRequired] = values;
      const row: Record<string, unknown> = {
        id: this.nextId('notif'), companyId, userId, type, title, body, resourceType, resourceId, projectId, createdBy,
        category, priority, actionRequired, readAt: null, acknowledgedAt: null, escalatedAt: null, createdAt: new Date(),
      };
      this.notifications.push(row);
      return Promise.resolve([row]);
    }

    if (text.includes('UPDATE notifications SET escalated_at = NOW()')) {
      const id = this.findId(values, (v) => this.notifications.some((n) => n.id === v));
      const n = this.notifications.find((x) => x.id === id);
      if (n) n.escalatedAt = new Date();
      return Promise.resolve([]);
    }

    if (text.includes('SET acknowledged_at = COALESCE')) {
      const id = this.findId(values, (v) => this.notifications.some((n) => n.id === v));
      const n = this.notifications.find((x) => x.id === id);
      if (!n) return Promise.resolve([]);
      n.acknowledgedAt ??= new Date();
      n.readAt ??= new Date();
      return Promise.resolve([{ id: n.id, readAt: n.readAt, acknowledgedAt: n.acknowledgedAt }]);
    }

    // Escalation's own overdue scan: the only SELECT ... FROM notifications
    // with this exact predicate shape.
    if (text.includes('escalated_at IS NULL') && text.includes('FROM notifications')) {
      const cutoff = values.find((v): v is Date => v instanceof Date);
      const overdue = this.notifications.filter((n) =>
        n.priority === 'critical' && n.actionRequired === true && !n.acknowledgedAt && !n.escalatedAt
        && cutoff !== undefined && (n.createdAt as Date) <= cutoff);
      return Promise.resolve(overdue);
    }

    if (text.includes('FROM users')) {
      const id = this.findId(values, (v) => this.users.has(v));
      const user = id ? this.users.get(id) : undefined;
      return Promise.resolve(user ? [user] : []);
    }

    if (text.includes('UPDATE users SET preferences')) {
      const json = values[0];
      const id = this.findId(values, (v) => this.users.has(v));
      const user = id ? this.users.get(id) : undefined;
      if (user) user.preferences = { notifications: json };
      return Promise.resolve([]);
    }

    if (text.includes('FROM workforce_reporting_lines')) {
      const userId = values[0] as string;
      const managerId = this.managerOf.get(userId);
      return Promise.resolve(managerId ? [{ managerId }] : []);
    }

    if (text.includes('INSERT INTO notification_email_deliveries')) {
      const [companyId, notificationId, toEmail] = values;
      const row = { id: this.nextId('email-delivery'), companyId, notificationId, toEmail, status: 'pending', attempts: 0, lastError: null };
      this.emailDeliveries.push(row);
      return Promise.resolve([row]);
    }

    if (text.includes('FROM notification_email_deliveries d')) {
      const id = this.findId(values, (v) => this.emailDeliveries.some((d) => d.id === v));
      const delivery = this.emailDeliveries.find((d) => d.id === id);
      if (!delivery) return Promise.resolve([]);
      const n = this.notifications.find((x) => x.id === delivery.notificationId);
      return Promise.resolve([{ id: delivery.id, toEmail: delivery.toEmail, title: n?.title, body: n?.body, category: n?.category, priority: n?.priority, actionRequired: n?.actionRequired }]);
    }

    if (text.includes('UPDATE notification_email_deliveries SET')) {
      const id = this.findId(values, (v) => this.emailDeliveries.some((d) => d.id === v));
      const delivery = this.emailDeliveries.find((d) => d.id === id);
      if (delivery) {
        delivery.attempts = (delivery.attempts as number) + 1;
        delivery.status = text.includes("status = 'failed'") ? 'failed' : 'delivered';
      }
      return Promise.resolve([]);
    }

    if (text.includes('INSERT INTO notification_whatsapp_deliveries')) {
      const [companyId, notificationId, toPhone] = values;
      const row = { id: this.nextId('wa-delivery'), companyId, notificationId, toPhone, status: 'pending', providerMessageId: null, attempts: 0, lastError: null };
      this.whatsappDeliveries.push(row);
      return Promise.resolve([row]);
    }

    if (text.includes('FROM notification_whatsapp_deliveries d')) {
      const id = this.findId(values, (v) => this.whatsappDeliveries.some((d) => d.id === v));
      const delivery = this.whatsappDeliveries.find((d) => d.id === id);
      if (!delivery) return Promise.resolve([]);
      const n = this.notifications.find((x) => x.id === delivery.notificationId);
      return Promise.resolve([{ id: delivery.id, toPhone: delivery.toPhone, title: n?.title, body: n?.body }]);
    }

    if (text.includes('UPDATE notification_whatsapp_deliveries SET')) {
      const id = this.findId(values, (v) => this.whatsappDeliveries.some((d) => d.id === v));
      const delivery = this.whatsappDeliveries.find((d) => d.id === id);
      if (delivery) {
        delivery.attempts = (delivery.attempts as number) + 1;
        if (text.includes("status = 'failed'")) delivery.status = 'failed';
        else if (text.includes("status = 'skipped_not_configured'")) delivery.status = 'skipped_not_configured';
        else {
          delivery.status = 'sent';
          delivery.providerMessageId = values.find((v) => typeof v === 'string' && v.startsWith('wamid'));
        }
      }
      return Promise.resolve([]);
    }

    throw new Error(`FakeDb: unrecognized query -- ${text}`);
  }
}

function makeHarness() {
  const db = new FakeDb();
  const emitToUser = jest.fn();
  const gateway = { emitToUser } as unknown as NotificationsGateway;
  const emailService = { send: jest.fn().mockResolvedValue(undefined) };
  const whatsapp = { isConfigured: jest.fn().mockReturnValue(true), sendTemplateMessage: jest.fn().mockResolvedValue({ messageId: 'wamid.e2e-1' }) };

  const emailProcessor = new NotificationEmailProcessor(db as unknown as DatabaseService, emailService as unknown as EmailService);
  const whatsappProcessor = new NotificationWhatsAppProcessor(db as unknown as DatabaseService, whatsapp as unknown as WhatsAppService);

  // Stand-in for Bull: runs the real processor synchronously instead of
  // scheduling a worker job, so the whole create() -> enqueue -> deliver
  // chain resolves (and is assertable) within a single awaited call.
  const emailQueue = { add: jest.fn((_job: string, data: NotificationEmailJobData) => emailProcessor.handleDeliver({ data } as never)) };
  const whatsappQueue = { add: jest.fn((_job: string, data: NotificationWhatsAppJobData) => whatsappProcessor.handleDeliver({ data } as never)) };

  const notifications = new NotificationsService(
    db as unknown as DatabaseService, gateway, whatsapp as unknown as WhatsAppService, emailQueue as never, whatsappQueue as never,
  );
  const escalation = new NotificationEscalationService(db as unknown as DatabaseService, notifications);

  return { db, notifications, escalation, emailService, whatsapp, emitToUser };
}

describe('Notification engine (Phase 5 integration)', () => {
  const companyId = 'company-1';

  it('delivers a high-priority, action-required notification by email end to end', async () => {
    const { db, notifications, emailService, emitToUser } = makeHarness();
    db.users.set('user-assignee', { id: 'user-assignee', email: 'assignee@example.com', phone: null, preferences: null, isActive: true });

    const row = await notifications.create(companyId, {
      userId: 'user-assignee', type: 'rfi_overdue', title: 'RFI overdue', body: 'RFI-0012 is overdue.',
      category: 'rfi', priority: 'high', actionRequired: true,
    });

    expect(emitToUser).toHaveBeenCalledWith('user-assignee', expect.objectContaining({ id: row.id }));
    expect(emailService.send).toHaveBeenCalledTimes(1);
    const [to, subject] = emailService.send.mock.calls[0] as [string, string];
    expect(to).toBe('assignee@example.com');
    expect(subject).toContain('RFI overdue');
    expect(db.emailDeliveries[0].status).toBe('delivered');
  });

  it('delivers a critical, opted-in notification by both email and WhatsApp end to end', async () => {
    const { db, notifications, emailService, whatsapp } = makeHarness();
    db.users.set('user-foreman', {
      id: 'user-foreman', email: 'foreman@example.com', phone: '+1 (555) 987-6543', isActive: true,
      preferences: { notifications: { whatsappEnabled: true } },
    });

    await notifications.create(companyId, {
      userId: 'user-foreman', type: 'issue_assigned', title: 'Critical safety issue', body: 'Scaffold failure reported.',
      category: 'issue', priority: 'critical', actionRequired: true,
    });

    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(db.emailDeliveries[0].status).toBe('delivered');
    expect(whatsapp.sendTemplateMessage).toHaveBeenCalledWith('15559876543', 'Critical safety issue', 'Scaffold failure reported.', expect.any(String));
    expect(db.whatsappDeliveries[0].status).toBe('sent');
    expect(db.whatsappDeliveries[0].providerMessageId).toBe('wamid.e2e-1');
  });

  it('enforces a muted category end to end, except for critical priority', async () => {
    const { db, notifications, emailService } = makeHarness();
    db.users.set('user-sub', { id: 'user-sub', email: 'sub@example.com', isActive: true });

    await notifications.updatePreferences(companyId, 'user-sub', { mutedCategories: ['rfi'] });

    await notifications.create(companyId, { userId: 'user-sub', type: 'rfi_overdue', title: 'RFI overdue', category: 'rfi', priority: 'high' });
    expect(emailService.send).not.toHaveBeenCalled();

    await notifications.create(companyId, { userId: 'user-sub', type: 'rfi_overdue', title: 'RFI critically overdue', category: 'rfi', priority: 'critical', actionRequired: true });
    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('escalates an unacknowledged critical notification to the manager, who is then notified end to end', async () => {
    const { db, notifications, escalation, emailService } = makeHarness();
    db.users.set('user-worker', { id: 'user-worker', email: 'worker@example.com', isActive: true });
    db.users.set('user-boss', { id: 'user-boss', email: 'boss@example.com', isActive: true });
    db.managerOf.set('user-worker', 'user-boss');

    const original = await notifications.create(companyId, {
      userId: 'user-worker', type: 'issue_assigned', title: 'Critical issue', body: 'Needs sign-off.',
      category: 'issue', priority: 'critical', actionRequired: true,
    });
    emailService.send.mockClear(); // Only interested in the escalation's own email from here.
    // Backdate past the 2-hour escalation threshold.
    const stored = db.notifications.find((n) => n.id === original.id)!;
    stored.createdAt = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const result = await escalation.escalateOverdue();

    expect(result).toEqual({ checked: 1, escalated: 1 });
    expect(stored.escalatedAt).toBeInstanceOf(Date);
    const escalated = db.notifications.find((n) => n.type === 'issue_assigned_escalated');
    expect(escalated).toMatchObject({ userId: 'user-boss', category: 'escalation', priority: 'critical', actionRequired: true });
    // The escalation notification is itself a real create() call -- it
    // goes through the exact same dispatch pipeline, so the manager gets
    // emailed too (critical bypass), proving escalation composes with the
    // rest of the engine rather than being a dead end.
    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect((emailService.send.mock.calls[0] as [string])[0]).toBe('boss@example.com');
  });

  it('does not escalate once the recipient has acknowledged the notification', async () => {
    const { db, notifications, escalation } = makeHarness();
    db.users.set('user-worker', { id: 'user-worker', email: 'worker@example.com', isActive: true });
    db.users.set('user-boss', { id: 'user-boss', email: 'boss@example.com', isActive: true });
    db.managerOf.set('user-worker', 'user-boss');

    const original = await notifications.create(companyId, {
      userId: 'user-worker', type: 'issue_assigned', title: 'Critical issue', priority: 'critical', actionRequired: true,
    });
    const stored = db.notifications.find((n) => n.id === original.id)!;
    stored.createdAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await notifications.acknowledge(companyId, 'user-worker', original.id as string);

    const result = await escalation.escalateOverdue();

    expect(result).toEqual({ checked: 0, escalated: 0 });
  });
});
