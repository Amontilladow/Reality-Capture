import type { NotificationCategory, NotificationPriority } from './notifications.service';

export interface NotificationEmailContent {
  title: string;
  body?: string | null;
  category?: NotificationCategory | null;
  priority: NotificationPriority;
  actionRequired: boolean;
}

const PRIORITY_LABEL: Record<NotificationPriority, string> = {
  critical: 'Critical',
  high: 'High priority',
  normal: 'Notification',
};

const PRIORITY_COLOR: Record<NotificationPriority, string> = {
  critical: '#b91c1c',
  high: '#c2410c',
  normal: '#1e3a8a',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// One shared layout for every notification email, rather than one template
// per category/type: with ~30 distinct `type` values already in use across
// the app (and more added by every future module), a per-type template
// would need constant upkeep just to stay in sync with copy that lives in
// `title`/`body` anyway. The priority banner + action-required badge are the
// only category-spanning signals worth a dedicated look.
export function buildNotificationEmail(n: NotificationEmailContent): { subject: string; text: string; html: string } {
  const label = PRIORITY_LABEL[n.priority];
  const color = PRIORITY_COLOR[n.priority];
  const subjectPrefix = n.priority === 'critical' ? '[Critical] ' : n.priority === 'high' ? '[High priority] ' : '';
  const subject = `${subjectPrefix}${n.title}`;

  const text = [
    `${label}${n.category ? ` · ${n.category}` : ''}`,
    '',
    n.title,
    n.body ? `\n${n.body}` : '',
    n.actionRequired ? '\nThis notification requires your action.' : '',
    '\nView it in RealityCapture: open the notification bell or the Notifications page.',
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <div style="border-left: 4px solid ${color}; padding: 4px 16px;">
        <p style="color: ${color}; font-weight: bold; margin: 0 0 8px;">
          ${escapeHtml(label)}${n.category ? ` &middot; ${escapeHtml(n.category)}` : ''}
        </p>
        <h2 style="margin: 0 0 12px; font-size: 18px;">${escapeHtml(n.title)}</h2>
        ${n.body ? `<p style="margin: 0 0 12px; color: #374151;">${escapeHtml(n.body)}</p>` : ''}
        ${n.actionRequired ? '<p style="margin: 0 0 12px; font-weight: bold;">This notification requires your action.</p>' : ''}
        <p style="margin: 16px 0 0; font-size: 13px; color: #6b7280;">
          Open RealityCapture and check the notification bell, or visit the Notifications page, for details and links.
        </p>
      </div>
    </div>
  `;

  return { subject, text, html };
}
