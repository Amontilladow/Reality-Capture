import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { StatusBadge } from '../ui/Badge';
import { apiErrorMessage } from '../../lib/api';
import {
  listImportBatches, listReviewQueue, resolveReview, deleteSiteDrawing, deleteImportBatch,
  type SiteDrawingImportBatch, type SiteDrawingReviewQueueItem,
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

  const batchesQuery = useQuery({
    queryKey: ['site-drawing-import-batches', projectId],
    queryFn: () => listImportBatches(projectId),
    enabled: open,
    refetchInterval: (query) => (query.state.data ?? []).some((b) => isImportBatchInProgress(b.status)) ? 4000 : false,
  });

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
          {b.fileCount} file{b.fileCount === 1 ? '' : 's'} · {b.createdCount} new · {b.revisionCount} revision{b.revisionCount === 1 ? '' : 's'} ·
          {' '}{b.skippedCount} skipped (duplicate){b.errorCount > 0 ? ` · ${b.errorCount} error${b.errorCount === 1 ? '' : 's'}` : ''}
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

  const mutation = useMutation({
    mutationFn: () => resolveReview(projectId, item.id, {
      drawingNumber: drawingNumber !== item.drawingNumber ? drawingNumber : undefined,
      drawingTitle: drawingTitle !== item.drawingTitle ? drawingTitle : undefined,
      revisionNumber: revisionNumber !== item.revisionNumber ? revisionNumber : undefined,
      reviewNotes: reviewNotes.trim(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-drawing-review-queue', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawings', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawing-dashboard-stats', projectId] });
    },
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

  return (
    <div className="panel tick-frame p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-ink-100">
          {item.drawingNumber} <span className="text-ink-500">· {item.drawingTitle}</span>
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

      {/* What the extraction pipeline actually read (brief section 3: "AI may
          assist with extraction, but it must not invent missing values") --
          shown alongside the correction fields so a reviewer can see exactly
          what the system found before deciding whether to change it. */}
      {item.extractedFieldsRaw && (
        <p className="text-xs text-ink-500">
          Extracted via {item.extractedFieldsRaw.source === 'ocr' ? 'OCR' : 'embedded text'}
          {' '}(confidence {Math.round(item.extractedFieldsRaw.confidence * 100)}%):
          {' '}drawing no. "{item.extractedFieldsRaw.drawingNumber ?? '—'}", title "{item.extractedFieldsRaw.drawingTitle ?? '—'}",
          revision "{item.extractedFieldsRaw.revisionNumber ?? '—'}"
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="field-label" htmlFor={`rq-number-${item.id}`}>Drawing number</label>
          <input id={`rq-number-${item.id}`} className="field-input text-sm" value={drawingNumber} onChange={(e) => setDrawingNumber(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor={`rq-title-${item.id}`}>Title</label>
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

      {mutation.isError && <p className="field-error">{apiErrorMessage(mutation.error)}</p>}

      <div className="flex justify-end">
        <button
          onClick={() => mutation.mutate()}
          disabled={!reviewNotes.trim() || !drawingNumber.trim() || !drawingTitle.trim() || !revisionNumber.trim() || mutation.isPending}
          className="btn-primary !px-4 !py-2 "
        >
          {mutation.isPending ? 'Confirming…' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
