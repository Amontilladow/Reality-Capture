import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Animation, EventProps } from 'react-useanimations';
import { WithAnimatedIcon } from './AnimatedIcon';
import { chain } from '../../lib/chain-handlers';

// A button that opens a short list of actions: the "More" and "⋯" menus
// that keep secondary actions out of the way. The list renders through a
// portal (so no clipped or overflow-hidden parent can cut it off), sits
// under its button, and is keyboard friendly: arrows move between items,
// Escape closes and returns focus to the button.

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  /** Animated icon (replaces `icon`), played as the item is pointed at or arrowed onto. */
  anim?: Animation;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}
export interface MenuSection {
  heading?: string;
  items: MenuItem[];
}

const WIDTH = 256; // w-64
const GUTTER = 16;

export function Menu({
  label,
  buttonClassName = 'btn-secondary',
  buttonContent,
  sections,
  align = 'right',
}: {
  /** Accessible name for the button (and the list). */
  label: string;
  buttonClassName?: string;
  buttonContent: ReactNode;
  sections: MenuSection[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = align === 'right' ? r.right - WIDTH : r.left;
      setStyle({ top: r.bottom + 8, left: Math.max(GUTTER, Math.min(left, window.innerWidth - WIDTH - GUTTER)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);

  // Focus the first item once the list is placed (it is hidden, and so
  // unfocusable, until then).
  useEffect(() => {
    if (open && style) listRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open, style]);

  // Escape closes from anywhere, even if focus has moved off the list.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={buttonClassName}
      >
        {buttonContent}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={listRef}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            style={{ position: 'fixed', ...style, visibility: style ? 'visible' : 'hidden' }}
            className="z-[61] w-64 rounded-xl border border-ink-100/10 bg-base-800 shadow-xl py-2"
          >
            {sections.map((section, s) => (
              <div key={s} className={s > 0 ? 'mt-2 pt-2 border-t border-ink-100/10' : ''}>
                {section.heading && (
                  <div className="px-4 pt-2 pb-2 text-eyebrow font-medium uppercase text-ink-500">{section.heading}</div>
                )}
                {section.items.map((item) => {
                  const row = (ev: Partial<EventProps>, icon: ReactNode) => (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      {...ev}
                      onClick={chain(ev.onClick, () => {
                        setOpen(false);
                        item.onSelect();
                      })}
                      className={`w-full flex items-center gap-4 px-4 h-11 text-sm text-left transition-colors hover:bg-ink-100/5 focus:bg-ink-100/5 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
                        item.danger ? 'text-danger' : 'text-ink-100'
                      }`}
                    >
                      {icon && <span className={`w-5 h-5 grid place-items-center shrink-0 ${item.danger ? '' : 'text-ink-300'}`}>{icon}</span>}
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                  return item.anim
                    ? <WithAnimatedIcon key={item.label} animation={item.anim} interaction="hover-replay">{row}</WithAnimatedIcon>
                    : row({}, item.icon);
                })}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
