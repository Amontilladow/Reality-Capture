import { create } from 'zustand';

// The app's own confirmation and alert dialogs, in place of the browser's
// confirm()/alert() (unthemed, uncentred on some devices, and impossible to
// style). Call from anywhere; ConfirmHost (mounted once in main.tsx) shows
// them one at a time.
//
//   if (await confirmDialog({ message: 'Delete 6 drawings? This cannot be undone.' })) …
//
// Unless given, the title is the message's question (up to its first "?"),
// the body is what follows, and the button is named after the action
// ("Delete", "Remove", "Close"…); deletes and removes are styled as danger.

export interface ConfirmRequest {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  /** An alert: one button, no cancel. */
  alert?: boolean;
}

interface Pending extends ConfirmRequest {
  id: number;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  queue: Pending[];
  push: (r: Pending) => void;
  settle: (id: number, ok: boolean) => void;
}

let nextId = 0;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  queue: [],
  push: (r) => set((s) => ({ queue: [...s.queue, r] })),
  settle: (id, ok) => {
    const item = get().queue.find((q) => q.id === id);
    set((s) => ({ queue: s.queue.filter((q) => q.id !== id) }));
    item?.resolve(ok);
  },
}));

export function confirmDialog(request: ConfirmRequest | string): Promise<boolean> {
  const r = typeof request === 'string' ? { message: request } : request;
  return new Promise((resolve) => useConfirmStore.getState().push({ ...r, id: nextId++, resolve }));
}

export function alertDialog(message: string, title = 'Something went wrong'): Promise<void> {
  return confirmDialog({ message, title, alert: true, confirmLabel: 'OK' }).then(() => undefined);
}

const DANGER_VERBS = ['Delete', 'Remove', 'Discard', 'Revoke'];

/** Title, body, button label and tone from a plain-language message. */
export function describe(r: ConfirmRequest) {
  const q = r.message.indexOf('?');
  const title = r.title ?? (q > 0 ? r.message.slice(0, q + 1) : r.alert ? 'Notice' : 'Are you sure?');
  const body = r.title ? r.message : q > 0 ? r.message.slice(q + 1).trim() : r.message;
  const verb = r.message.trim().split(/\s+/)[0]?.replace(/[^A-Za-z]/g, '') ?? '';
  const tone = r.tone ?? (DANGER_VERBS.includes(verb) ? 'danger' : 'default');
  const confirmLabel = r.confirmLabel ?? (r.alert ? 'OK' : /^[A-Z][a-z]+$/.test(verb) && verb.length <= 10 ? verb : 'Confirm');
  return { title, body: body === title ? '' : body, tone, confirmLabel, cancelLabel: r.cancelLabel ?? 'Cancel' };
}
