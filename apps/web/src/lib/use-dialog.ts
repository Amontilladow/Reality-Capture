import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open-dialog behaviour every popup in the app shares:
//  - Escape closes it (the topmost one only, when dialogs stack);
//  - focus moves into it and Tab stays inside; it returns to whatever
//    opened the dialog once it closes;
//  - the page behind doesn't scroll while it is open.
const openStack: symbol[] = [];

export function useDialog(open: boolean, onClose: () => void, panelRef: RefObject<HTMLElement>, initialFocus?: RefObject<HTMLElement>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = Symbol('dialog');
    openStack.push(id);
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus after paint, so the panel exists.
    const t = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const target = initialFocus?.current ?? panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
      target.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      const i = openStack.indexOf(id);
      if (i >= 0) openStack.splice(i, 1);
      if (openStack.length === 0) document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open, panelRef, initialFocus]);
}
