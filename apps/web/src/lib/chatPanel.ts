import { useSyncExternalStore } from 'react';

// Open/closed state of the live team-chat panel (ChatWidget). It lives
// here rather than inside the widget because the panel no longer has its
// own floating launcher: the header's single Messages menu opens it.
let open = false;
const listeners = new Set<() => void>();

export function setChatPanelOpen(next: boolean | ((prev: boolean) => boolean)) {
  open = typeof next === 'function' ? next(open) : next;
  listeners.forEach((l) => l());
}

export function useChatPanelOpen(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => open,
    () => false,
  );
}
