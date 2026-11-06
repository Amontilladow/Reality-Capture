import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

// One look for every icon button in the app chrome (notifications,
// messages): a 36px round hit area with a 20px glyph, and an unread count
// that sits on the glyph's top-right corner instead of on top of it. The
// count is cut out from the bar with a ring in the canvas colour, so the
// icon's outline stays readable underneath.
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  count?: number;
}

export const HeaderIconButton = forwardRef<HTMLButtonElement, Props>(function HeaderIconButton(
  { icon, count = 0, className = '', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`relative flex items-center justify-center w-9 h-9 rounded-full text-ink-300 hover:bg-base-700 hover:text-ink-100 transition-colors ${className}`}
      {...rest}
    >
      {icon}
      {count > 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-0 min-w-5 h-5 px-0 rounded-full bg-danger text-base-950 ring-2 ring-base-950 text-xs leading-none font-semibold tabular-nums tracking-tight flex items-center justify-center"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
});

export function BellIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 1 1 12 0c0 3.5.8 5.6 1.6 6.8.4.6 0 1.2-.7 1.2H5.1c-.7 0-1.1-.6-.7-1.2C5.2 14.6 6 12.5 6 9z" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

export function ChatIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5-1.1 0-2.2-.2-3.1-.5L4 20l1.3-3.6C4.5 15.2 4 13.9 4 12.5 4 8.9 7.6 6 12 6s8 2.9 8 6.5z" />
    </svg>
  );
}
