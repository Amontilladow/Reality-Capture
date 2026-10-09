import { useToastStore } from '../../store/toast.store';
import type { ToastTone } from '../../store/toast.store';

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'border-ok/30 text-ok',
  danger: 'border-danger/30 text-danger',
  info: 'border-blueprint/30 text-blueprint',
};

// Mounted once near the app root (main.tsx). Renders whatever's currently
// in useToastStore -- call showToast(message, tone) from anywhere to add
// one, no provider wiring needed at the call site.
export function ToastViewport() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);

  if (items.length === 0) return null;

  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          className={`panel border px-4 py-3 text-sm text-ink-100 shadow-lg toast-in cursor-pointer ${TONE_CLASS[t.tone]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
