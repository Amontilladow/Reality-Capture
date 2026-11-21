import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { apiErrorMessage } from '../../lib/api';
import { updateSiteDrawing, type SiteDrawingWithCurrentRevision } from '../../lib/site-drawings.api';

// The write-access gap the user hit directly: once a drawing has left the
// Review Queue (or was never flagged for review at all), there was no way
// back in to fix an extractor mistake -- e.g. four distinct drawings
// collapsing into one "PR-169 / SE45_01" register entry. This is the same
// correction resolveReview() already offers a reviewer, reachable here for
// any drawing already sitting plainly in the register.
export function EditSiteDrawingModal({ open, onClose, projectId, drawing }: {
  open: boolean; onClose: () => void; projectId: string; drawing: SiteDrawingWithCurrentRevision;
}) {
  const queryClient = useQueryClient();
  const [drawingNumber, setDrawingNumber] = useState(drawing.drawingNumber);
  const [drawingTitle, setDrawingTitle] = useState(drawing.drawingTitle);
  const [revisionNumber, setRevisionNumber] = useState(drawing.currentRevision?.revisionNumber ?? '');

  const mutation = useMutation({
    mutationFn: () => updateSiteDrawing(projectId, drawing.id, {
      drawingNumber: drawingNumber.trim(),
      drawingTitle: drawingTitle.trim(),
      ...(drawing.currentRevision ? { revisionNumber: revisionNumber.trim() } : {}),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-drawing', projectId, drawing.id] });
      queryClient.invalidateQueries({ queryKey: ['site-drawing-revisions', projectId, drawing.id] });
      queryClient.invalidateQueries({ queryKey: ['site-drawings', projectId] });
      onClose();
    },
  });

  const canSubmit = Boolean(
    drawingNumber.trim() && drawingTitle.trim() && (!drawing.currentRevision || revisionNumber.trim()),
  );

  return (
    <Modal open={open} onClose={onClose} title="Correct drawing details">
      <div className="space-y-4">
        <p className="text-xs text-ink-500">
          Fix a mistake the extractor made -- this changes the register entry itself, not just this revision's pending review.
        </p>
        <div>
          <label className="field-label" htmlFor="edit-drawing-number">Drawing number</label>
          <input id="edit-drawing-number" className="field-input" value={drawingNumber} onChange={(e) => setDrawingNumber(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="edit-drawing-title">Drawing title</label>
          <input id="edit-drawing-title" className="field-input" value={drawingTitle} onChange={(e) => setDrawingTitle(e.target.value)} />
        </div>
        {drawing.currentRevision && (
          <div>
            <label className="field-label" htmlFor="edit-revision-number">Current revision</label>
            <input id="edit-revision-number" className="field-input" value={revisionNumber} onChange={(e) => setRevisionNumber(e.target.value)} />
          </div>
        )}
        {mutation.isError && <p className="field-error">{apiErrorMessage(mutation.error)}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
