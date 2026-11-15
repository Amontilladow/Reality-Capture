import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

const MENU_WIDTH = 320; // md:w-80
const GUTTER = 16;

// Where a header button's dropdown sits on tablet/desktop: just under the
// button, kept inside the viewport. The menus render through a portal
// (the curved sidebar clips anything that crosses its edge), so they are
// positioned from the button's on-screen rect rather than by CSS. On a
// phone this returns undefined and the menu's own full-width classes
// apply.
export function useMenuPosition(anchor: RefObject<HTMLElement>, open: boolean): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchor.current;
      if (!el || !window.matchMedia?.('(min-width: 768px)').matches) {
        setStyle(undefined);
        return;
      }
      const r = el.getBoundingClientRect();
      setStyle({ top: r.bottom + 8, left: Math.max(GUTTER, Math.min(r.left, window.innerWidth - MENU_WIDTH - GUTTER)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor]);
  return style;
}
