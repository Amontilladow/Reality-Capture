import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { StatusBadge } from '../ui/Badge';
import { apiErrorMessage } from '../../lib/api';
import {
  listImportBatches, listReviewQueue, resolveReview, confirmRevisionAsNew, splitRevisionAsNewDrawing, deleteSiteDrawing, deleteImportBatch,
  type SiteDrawingImportBatch, type SiteDrawingImportBatchStatus, type SiteDrawingReviewQueueItem,
} from '../../lib/site-drawings.api';
import {
  IMPORT_BATCH_STATUS_LABELS, IMPORT_BATCH_STATUS_TONE, isImportBatchInProgress, sourceProviderLabel,
  EXTRACTION_STATUS_LABELS, EXTRACTION_STATUS_TONE, formatDate,
} from './siteDrawingDisplay';

// Surfaces the two halves of the existing bulk-import pipeline that had no
// UI at all: batch progress/errors (brief section 2) and the review queue
// for uncertain extractions (brief section 4). Polls while any batch is
// still PENDING/PROCESSING -- import runs in a background worker, so
// there's no other way to see it move without a page reload.
export function ImportActivityModal({
  open, onClose, projectId, initialTab = 'batches',
}: {
  open: boolean; onClose: () => void; projectId: string; initialTab?: 'batches' | 'review';
}) {
  const [tab, setTab] = useState<'batches' | 'review'>(initialTab);
  const queryClient = useQueryClient();

  const batchesQuery = useQuery({
    queryKey: ['site-drawing-import-batches', projectId],
    queryFn: () => listImportBatches(projectId),
    enabled: open,
    refetchInterval: (query) => (query.state.data ?? []).some((b) => isImportBatchInProgress(b.status)) ? 4000 : false,
  });

  // The import itself runs in a background worker; this modal only learns
  // it finished by polling batchesQuery above, which refetches its OWN
  // query only. Nothing else ever told the Site Drawings register (or its
  // review-queue badge / dashboard stats) to refetch, so a user who
  // watched a batch go PENDING -> COMPLETED right here, then checked the
  // register, saw it still missing the new/updated drawings -- the same
  // "it finished, but nowhere that matters shows it" cache gap the capture
  // delete fix (BuildLens Timeline/Grid/Lightbox) already fixed once this
  // session, just for this page pair instead. Detected as a transition
  // (in-progress -> finished), not "invalidate on every poll tick": a
  // ref holds each batch's last-seen status so this only fires once per
  // batch actually finishing, not every 4s while nothing has changed.
  const lastSeenStatuses = useRef<Map<string, SiteDrawingImportBatchStatus>>(new Map());
  useEffect(() => {
    const batches = batchesQuery.data;
    if (!batches) return;
    const previous = lastSeenStatuses.current;
    const anyJustFinished = batches.some((b) => {
      const prevStatus = previous.get(b.id);
      return prevStatus !== undefined && isImportBatchInProgress(prevStatus) && !isImportBatchInProgress(b.status);
    });
    lastSeenStatuses.current = new Map(batches.map((b) => [b.id, b.status]));
    if (anyJustFinished) {
      queryClient.invalidateQueries({ queryKey: ['site-drawings', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawing-dashboard-stats', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawing-review-queue', projectId] });
    }
  }, [batchesQuery.data, projectId, queryClient]);

  const reviewQueueQuery = useQuery({
    queryKey: ['site-drawing-review-queue', projectId],
    queryFn: () => listReviewQueue(projectId),
    enabled: open,
  });

  const reviewCount = reviewQueueQuery.data?.length ?? 0;

  return (
    <Modal open={open} onClose={onClose} title="Import activity" wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b border-base-600">
          <button onClick={() => setTab('batches')} className={`px-4 py-2 text-sm ${tab === 'batches' ? 'border-b-2 border-blueprint text-blueprint' : 'text-ink-500 hover:text-ink-100'}`}>
            Batches
          </button>
          <button onClick={() => setTab('review')} className={`px-4 py-2 text-sm ${tab === 'review' ? 'border-b-2 border-blueprint text-blueprint' : 'text-ink-500 hover:text-ink-100'}`}>
            Review Queue{reviewCount > 0 ? ` (${reviewCount})` : ''}
          </button>
        </div>

        {tab === 'batches' && <BatchesTab projectId={projectId} batches={batchesQuery.data ?? []} isLoading={batchesQuery.isLoading} />}
        {tab === 'review' && <ReviewQueueTab projectId={projectId} items={reviewQueueQuery.data ?? []} isLoading={reviewQueueQuery.isLoading} />}
      </div>
    </Modal>
  );
}

function BatchesTab({ projectId, batches, isLoading }: { projectId: string; batches: SiteDrawingImportBatch[]; isLoading: boolean }) {
  const queryClient = useQueryClient();

  // One-shot cleanup for the whole list at once, same non-destructive
  // "log entry only" guarantee as each row's own Delete (deleteImportBatch's
  // comment on the API side) -- for a project that's been reimported/
  // retested repeatedly, deleting dozens of rows one at a time isn't
  // realistic.
  const clearAllMutation = useMutation({
    mutationFn: () => Promise.all(batches.map((b) => deleteImportBatch(projectId, b.id))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-drawing-import-batches', projectId] });
    },
  });

  if (isLoading) return <p className="text-sm text-ink-500">Loading…</p>;
  if (batches.length === 0) return <p className="text-sm text-ink-500">No imports yet.</p>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        {clearAllMutation.isError
          ? <p className="field-error">{apiErrorMessage(clearAllMutation.error)}</p>
          : <span />}
        <button
          onClick={() => {
            if (confirm(`Remove all ${batches.length} import batches from the activity log? This does not delete any drawings they already created.`)) clearAllMutation.mutate();
          }}
          disabled={clearAllMutation.isPending}
          className="btn-ghost !text-danger text-xs shrink-0"
        >
          {clearAllMutation.isPending ? 'Clearing…' : 'Clear all'}
        </button>
      </div>
      <div className="panel tick-frame divide-y divide-base-700/60">
        {batches.map((b) => <BatchRow key={b.id} projectId={projectId} batch={b} />)}
      </div>
    </div>
  );
}

function BatchRow({ projectId, batch: b }: { projectId: string; batch: SiteDrawingImportBatch }) {
  const queryClient = useQueryClient();

  // Clears this row from the log only -- never the drawings/revisions the
  // batch actually created (deleteImportBatch's own comment on the API
  // side). Without this, a project that gets reimported/retested a lot
  // (exactly what this list is for) just grows forever with no way to
  // clean it up.
  const deleteMutation = useMutation({
    mutationFn: () => deleteImportBatch(projectId, b.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-drawing-import-batches', projectId] });
    },
  });

  return (
    <div className="px-4 py-2">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm text-ink-100">{b.originalFilename}</div>
          <div className="text-xs text-ink-500">
            {sourceProviderLabel(b.sourceSystem)} · {formatDate(b.createdAt)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={IMPORT_BATCH_STATUS_TONE[b.status]} label={IMPORT_BATCH_STATUS_LABELS[b.status]} dot />
          <button
            onClick={() => { if (confirm('Remove this import batch from the activity log? This does not delete any drawings it already created.')) deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending}
            className="btn-secondary !text-danger !px-4 !py-2 text-xs"
          >
            {deleteMutation.isPending ? 'Removing…' : 'Delete'}
          </button>
        </div>
      </div>
      {b.status !== 'PENDING' && (
        <div className="text-xs text-ink-500 mt-2">
          {b.fileCount} PDF{b.fileCount === 1 ? '' : 's'}{b.unsupportedCount > 0 ? ` (+${b.unsupportedCount} unsupported skipped)` : ''}
          {' '}· {b.createdCount} new · {b.revisionCount} revision{b.revisionCount === 1 ? '' : 's'} ·
          {' '}{b.skippedCount} skipped (duplicate)
          {b.conflictCount > 0 ? ` · ${b.conflictCount} need review` : ''}
          {b.errorCount > 0 ? ` · ${b.errorCount} error${b.errorCount === 1 ? '' : 's'}` : ''}
        </div>
      )}
      {b.errorMessage && <div className="text-xs text-danger mt-2">{b.errorMessage}</div>}
      {deleteMutation.isError && <p className="field-error mt-2">{apiErrorMessage(deleteMutation.error)}</p>}
    </div>
  );
}

function ReviewQueueTab({ projectId, items, isLoading }: { projectId: string; items: SiteDrawingReviewQueueItem[]; isLoading: boolean }) {
  if (isLoading) return <p className="text-sm text-ink-500">Loading…</p>;
  if (items.length === 0) return <p className="text-sm text-ink-500">Nothing needs review right now.</p>;

  return (
    <div className="space-y-4">
      {items.map((item) => <ReviewQueueRow key={item.id} projectId={projectId} item={item} />)}
    </div>
  );
}

function ReviewQueueRow({ projectId, item }: { projectId: string; item: SiteDrawingReviewQueueItem }) {
  const queryClient = useQueryClient();
  const [drawingNumber, setDrawingNumber] = useState(item.drawingNumber);
  const [drawingTitle, setDrawingTitle] = useState(item.drawingTitle);
  const [revisionNumber, setRevisionNumber] = useState(item.revisionNumber);
  const [reviewNotes, setReviewNotes] = useState('');
  // Only meaningful when item.isPendingPromotion: the two outcomes Phase
  // 1/2 require a human to actually choose between, rather than this row
  // always meaning "confirm the values as extracted" the way it did when
  // every revision was already auto-promoted on arrival.
  const [decision, setDecision] = useState<'same_drawing' | 'different_drawing'>('same_drawing');

  const invalidateAfterResolution = () => {
    queryClient.invalidateQueries({ queryKey: ['site-drawing-review-queue', projectId] });
    queryClient.invalidateQueries({ queryKey: ['site-drawings', projectId] });
    queryClient.invalidateQueries({ queryKey: ['site-drawing-dashboard-stats', projectId] });
  };

  // Value-only correction: for an item that's already current (flagged
  // only because ITS OWN fields were low-confidence, e.g. an OCR read --
  // never for a pending, unpromoted one, which needs an identity decision
  // instead; see confirmMutation/splitMutation below).
  const mutation = useMutation({
    mutationFn: () => resolveReview(projectId, item.id, {
      drawingNumber: drawingNumber !== item.drawingNumber ? drawingNumber : undefined,
      drawingTitle: drawingTitle !== item.drawingTitle ? drawingTitle : undefined,
      revisionNumber: revisionNumber !== item.revisionNumber ? revisionNumber : undefined,
      reviewNotes: reviewNotes.trim(),
    }),
    onSuccess: invalidateAfterResolution,
  });

  // "Yes, this really is a new revision of the drawing it already matched
  // by number" -- promotes it to current exactly the way reconcile()
  // itself used to do automatically, now gated behind this explicit call.
  const confirmMutation = useMutation({
    mutationFn: () => confirmRevisionAsNew(projectId, item.id, reviewNotes.trim()),
    onSuccess: invalidateAfterResolution,
  });

  // "No, this is actually a different drawing" -- detaches it into its
  // own new drawing record using the corrected number/title a human just
  // supplied; the ORIGINALLY-matched drawing's own current revision is
  // left completely untouched by this.
  const splitMutation = useMutation({
    mutationFn: () => splitRevisionAsNewDrawing(projectId, item.id, {
      drawingNumber, drawingTitle, revisionNumber, reviewNotes: reviewNotes.trim(),
    }),
    onSuccess: invalidateAfterResolution,
  });

  // A flagged revision isn't always worth correcting -- a bad test import,
  // a duplicate that extraction misread as a conflict -- and Confirm above
  // requires filling in real values plus a note either way. This is the
  // one way out of the queue that doesn't: delete the whole drawing (and
  // every revision under it) outright, same action as the register's own
  // detail-drawer delete button, just reachable directly from here too.
  const deleteMutation = useMutation({
    mutationFn: () => deleteSiteDrawing(projectId, item.drawingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-drawing-review-queue', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawings', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawing-dashboard-stats', projectId] });
    },
  });

  const activeMutation = !item.isPendingPromotion ? mutation : decision === 'same_drawing' ? confirmMutation : splitMutation;
  const fieldsFilled = Boolean(reviewNotes.trim() && drawingNumber.trim() && drawingTitle.trim() && revisionNumber.trim());

  return (
    <div className="panel tick-frame p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-ink-100">
          {item.drawingNumber} <span className="text-ink-500">· {item.drawingTitle}</span>
          {/* Phase 1: this file was never silently attached without a
              trace -- isPendingPromotion means exactly that it's NOT yet
              this drawing's current revision, still awaiting one of the
              two decisions below. */}
          {item.isPendingPromotion && <span className="ml-2 text-xs text-warn">· not yet applied to the register</span>}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={EXTRACTION_STATUS_TONE[item.extractionStatus]} label={EXTRACTION_STATUS_LABELS[item.extractionStatus]} dot />
          <button
            onClick={() => { if (confirm('Delete this drawing and its entire revision history? This cannot be undone.')) deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending}
            className="btn-secondary !text-danger !px-4 !py-2 text-xs"
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete drawing'}
          </button>
        </div>
      </div>
      {deleteMutation.isError && <p className="field-error">{apiErrorMessage(deleteMutation.error)}</p>}

      {item.reviewNotes && (
        <p className="text-xs text-ink-300 bg-base-700/40 rounded px-4 py-2">{item.reviewNotes}</p>
      )}

      {/* Side by side (Phase 1: "display the existing drawing and incoming
          document side by side for review"): the register's own current
          identity for the matched drawing_number, next to what THIS file's
          extraction actually read -- never invented, shown exactly as
          found so a reviewer can judge the match themselves. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
        <div className="rounded border border-base-700/60 px-4 py-2">
          <div className="text-ink-500 uppercase tracking-wide mb-2">Existing drawing in the register</div>
          <div className="text-ink-100">{item.drawingNumber} · {item.drawingTitle}</div>
        </div>
        <div className="rounded border border-base-700/60 px-4 py-2">
          <div className="text-ink-500 uppercase tracking-wide mb-2">This file's own extraction</div>
          {item.extractedFieldsRaw ? (
            <div className="text-ink-100">
              {item.extractedFieldsRaw.drawingNumber ?? '—'} · {item.extractedFieldsRaw.drawingTitle ?? '— (no title read)'}
              <span className="text-ink-500">
                {' '}({item.extractedFieldsRaw.source === 'ocr' ? 'OCR' : 'embedded text'}, {Math.round(item.extractedFieldsRaw.confidence * 100)}% confidence)
              </span>
            </div>
          ) : <div className="text-ink-500">Nothing could be extracted from this file.</div>}
        </div>
      </div>

      {item.isPendingPromotion && (
        <div role="radiogroup" aria-label="Is this a new revision or a different drawing?" className="grid grid-cols-2 gap-2">
          <button
            type="button" role="radio" aria-checked={decision === 'same_drawing'} onClick={() => setDecision('same_drawing')}
            className={`h-9 rounded-lg border text-xs font-medium ${decision === 'same_drawing' ? 'bg-signal text-on-signal border-transparent' : 'border-ink-100/15 text-ink-300 hover:text-ink-100'}`}
          >
            Same drawing, new revision
          </button>
          <button
            type="button" role="radio" aria-checked={decision === 'different_drawing'} onClick={() => setDecision('different_drawing')}
            className={`h-9 rounded-lg border text-xs font-medium ${decision === 'different_drawing' ? 'bg-signal text-on-signal border-transparent' : 'border-ink-100/15 text-ink-300 hover:text-ink-100'}`}
          >
            A different drawing
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="field-label" htmlFor={`rq-number-${item.id}`}>
            {item.isPendingPromotion && decision === 'different_drawing' ? 'New drawing number' : 'Drawing number'}
          </label>
          <input id={`rq-number-${item.id}`} className="field-input text-sm" value={drawingNumber} onChange={(e) => setDrawingNumber(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor={`rq-title-${item.id}`}>
            {item.isPendingPromotion && decision === 'different_drawing' ? 'New drawing title' : 'Title'}
          </label>
          <input id={`rq-title-${item.id}`} className="field-input text-sm" value={drawingTitle} onChange={(e) => setDrawingTitle(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor={`rq-rev-${item.id}`}>Revision</label>
          <input id={`rq-rev-${item.id}`} className="field-input text-sm" value={revisionNumber} onChange={(e) => setRevisionNumber(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor={`rq-notes-${item.id}`}>Review notes (required)</label>
        <input
          id={`rq-notes-${item.id}`} className="field-input text-sm" value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)}
          placeholder="e.g. Confirmed against the title block — correct as extracted."
        />
      </div>

      {activeMutation.isError && <p className="field-error">{apiErrorMessage(activeMutation.error)}</p>}

      <div className="flex justify-end">
        <button
          onClick={() => {
            if (!item.isPendingPromotion) mutation.mutate();
            else if (decision === 'same_drawing') confirmMutation.mutate();
            else splitMutation.mutate();
          }}
          disabled={
            item.isPendingPromotion
              ? (decision === 'different_drawing' ? !fieldsFilled : !reviewNotes.trim()) || activeMutation.isPending
              : !fieldsFilled || activeMutation.isPending
          }
          className="btn-primary !px-4 !py-2 "
        >
          {activeMutation.isPending
            ? 'Saving…'
            : item.isPendingPromotion
              ? (decision === 'same_drawing' ? 'Confirm as new revision' : 'Split into a new drawing')
              : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
