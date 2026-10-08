import { create } from 'zustand';

export type ToastTone = 'success' | 'danger' | 'info';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastState {
  items: ToastItem[];
  show: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

const DEFAULT_DURATION_MS = 4000;
let nextId = 0;

// Zustand, matching auth.store.ts's convention, rather than a React Context
// -- a plain store (not hook-bound) can also fire from non-component code,
// e.g. an axios response interceptor reacting to a failed request, which a
// Context provider's hook could not reach.
export const useToastStore = create<ToastState>((set) => ({
  items: [],
  show: (message, tone = 'info') => {
    const id = nextId++;
    set((state) => ({ items: [...state.items, { id, tone, message }] }));
    setTimeout(() => {
      set((state) => ({ items: state.items.filter((t) => t.id !== id) }));
    }, DEFAULT_DURATION_MS);
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((t) => t.id !== id) })),
}));

// Call from anywhere -- a component, an API client, a store action -- that
// isn't itself rendering and so has no reason to subscribe via the hook.
export function showToast(message: string, tone?: ToastTone) {
  useToastStore.getState().show(message, tone);
}
