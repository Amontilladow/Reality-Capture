import type { ReactNode } from 'react';

// Wraps the existing .panel class with an optional header/footer slot, so
// pages stop hand-building "title row + divider + content" inside a bare
// .panel div differently each time. tickFrame opts into the app's corner-tick
// framing device (see .tick-frame in index.css) for the handful of surfaces
// that already use it (modals, the BIM viewer's property panel) -- most
// cards should leave it off, it's a deliberate accent, not a default.
export function Card({
  title,
  actions,
  footer,
  tickFrame = false,
  className = '',
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  tickFrame?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`panel ${tickFrame ? 'tick-frame' : ''} ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-base-600">
          {title && <h3 className="text-sm font-semibold truncate">{title}</h3>}
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="px-5 py-3 border-t border-base-600">{footer}</div>}
    </div>
  );
}
