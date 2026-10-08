import type { ReactNode } from 'react';

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const TONE_STYLE: Record<AlertTone, { wrap: string; icon: ReactNode }> = {
  info: {
    wrap: 'bg-blueprint/10 border-blueprint/30 text-blueprint',
    icon: <path d="M12 16v-4m0-4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" />,
  },
  success: {
    wrap: 'bg-ok/10 border-ok/30 text-ok',
    icon: <path d="M20 6 9 17l-5-5" />,
  },
  warning: {
    wrap: 'bg-warn/10 border-warn/30 text-warn',
    icon: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  },
  danger: {
    wrap: 'bg-danger/10 border-danger/30 text-danger',
    icon: <path d="M12 9v4m0 4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" />,
  },
};

// Inline banner for a persistent, page-level condition (validation summary,
// "this project is archived," a feature-degraded notice). For a one-shot
// reaction to an action the user just took, use the Toast system instead --
// an Alert stays until its cause is resolved or it's dismissed, a Toast
// times out on its own.
export function Alert({
  tone = 'info',
  title,
  children,
  onDismiss,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  onDismiss?: () => void;
}) {
  const style = TONE_STYLE[tone];
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${style.wrap}`}>
      <svg viewBox="0 0 24 24" className="w-4.5 h-4.5 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {style.icon}
      </svg>
      <div className="flex-1 text-ink-100">
        {title && <div className="font-medium mb-0.5">{title}</div>}
        {children && <div className="text-ink-300">{children}</div>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" className="text-ink-500 hover:text-ink-100 shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
