import { useSyncExternalStore } from 'react';

// Live boolean for a CSS media query. Falls back to `false` where
// matchMedia doesn't exist (jsdom, very old browsers), which callers treat
// as the small-screen layout.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia?.(query);
      mql?.addEventListener('change', onChange);
      return () => mql?.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

/** Tailwind's `md` breakpoint: the sidebar layout and every desktop grid. */
export const DESKTOP_QUERY = '(min-width: 768px)';
