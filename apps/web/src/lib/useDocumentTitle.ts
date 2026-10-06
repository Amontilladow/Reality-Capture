import { useEffect } from 'react';

// Per-route <title> for a client-routed SPA with one shared index.html --
// there's no per-route SSR, so this is the only way the browser tab,
// history entry, and bookmark get anything other than the generic app
// title. Restores the previous title on unmount so a page that renders
// briefly during a transition doesn't leave a stale title behind.
export function useDocumentTitle(title: string | undefined | null) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · EngineeringOS`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
