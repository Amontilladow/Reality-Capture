import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useConfirmStore, describe } from '../../store/confirm.store';
import { useDialog } from '../../lib/use-dialog';
import { AnimatedIcon } from './AnimatedIcon';
import aTrash from 'react-useanimations/lib/trash2';
import aAlert from 'react-useanimations/lib/alertCircle';
import aHelp from 'react-useanimations/lib/help';

// Shows confirmDialog()/alertDialog() requests, one at a time, as a themed
// dialog centred on any screen. On a phone the buttons stack full-width
// (the main action on top, within thumb reach); from tablet up they sit in
// a row, Cancel first. For a destructive action, focus starts on Cancel,
// so a stray Enter never deletes anything; Escape or the backdrop cancels.
export function ConfirmHost() {
  const current = useConfirmStore((s) => s.queue[0]);
  const settle = useConfirmStore((s) => s.settle);
  if (!current) return null;
  return <ConfirmDialog key={current.id} id={current.id} request={current} onSettle={settle} />;
}

function ConfirmDialog({ id, request, onSettle }: { id: number; request: Parameters<typeof describe>[0]; onSettle: (id: number, ok: boolean) => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const d = describe(request);
  const danger = d.tone === 'danger';
  useDialog(true, () => onSettle(id, false), panelRef, danger && !request.alert ? cancelRef : okRef);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6">
      <div className="dialog-backdrop-in absolute inset-0 bg-base-950/70 backdrop-blur-sm" onClick={() => onSettle(id, false)} aria-hidden="true" />
      <div
        ref={panelRef}
        role={request.alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={d.body ? bodyId : undefined}
        className="dialog-in relative w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-ink-100/10 bg-base-800 text-ink-100 shadow-xl p-6"
      >
        <div className="flex items-start gap-4">
          <span className={`w-12 h-12 shrink-0 rounded-xl grid place-items-center ${danger ? 'bg-danger/15 text-danger' : 'bg-ink-100/10 text-ink-100'}`}>
            <AnimatedIcon animation={danger ? aTrash : request.alert ? aAlert : aHelp} size={24} interaction="loop" autoplay loop={false} />
          </span>
          <div className="min-w-0 flex-1 pt-2">
            <h2 id={titleId} className="text-base font-semibold text-ink-100 break-words">{d.title}</h2>
            {d.body && <p id={bodyId} className="mt-2 text-sm text-ink-300 break-words">{d.body}</p>}
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {!request.alert && (
            <button ref={cancelRef} type="button" onClick={() => onSettle(id, false)} className="btn-secondary w-full sm:w-auto justify-center">
              {d.cancelLabel}
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            onClick={() => onSettle(id, true)}
            className={`${danger ? 'btn-danger' : 'btn-primary'} w-full sm:w-auto justify-center`}
          >
            {d.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
