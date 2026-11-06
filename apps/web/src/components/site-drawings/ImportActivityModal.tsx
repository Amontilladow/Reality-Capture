import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { StatusBadge } from '../ui/Badge';
import { apiErrorMessage } from '../../lib/api';
import {
  listImportBatches, listReviewQueue, resolveReview,
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

        {tab === 'batches' && <BatchesTab batches={batchesQuery.data ?? []} isLoading={batchesQuery.isLoading} />}
        {tab === 'review' && <ReviewQueueTab projectId={projectId} items={reviewQueueQuery.data ?? []} isLoading={reviewQueueQuery.isLoading} />}
      </div>
    </Modal>
  );
}

function BatchesTab({ batches, isLoading }: { batches: SiteDrawingImportBatch[]; isLoading: boolean }) {
  if (isLoading) return <p className="text-sm text-ink-500">Loading…</p>;
  if (batches.length === 0) return <p className="text-sm text-ink-500">No imports yet.</p>;

  return (
    <div className="panel tick-frame divide-y divide-base-700/60">
      {batches.map((b) => (
        <div key={b.id} className="px-4 py-2">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm text-ink-100">{b.originalFilename}</div>
              <div className="text-xs text-ink-500">
                {sourceProviderLabel(b.sourceSystem)} · {formatDate(b.createdAt)}
              </div>
            </div>
            <StatusBadge tone={IMPORT_BATCH_STATUS_TONE[b.status]} label={IMPORT_BATCH_STATUS_LABELS[b.status]} dot />
          </div>
          {b.status !== 'PENDING' && (
            <div className="text-xs text-ink-500 mt-2">
              {b.fileCount} file{b.fileCount === 1 ? '' : 's'} · {b.createdCount} new · {b.revisionCount} revision{b.revisionCount === 1 ? '' : 's'} ·
              {' '}{b.skippedCount} skipped (duplicate){b.errorCount > 0 ? ` · ${b.errorCount} error${b.errorCount === 1 ? '' : 's'}` : ''}
            </div>
          )}
          {b.errorMessage && <div className="text-xs text-danger mt-2">{b.errorMessage}</div>}
        </div>
      ))}
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

  return (
    <div className="panel tick-frame p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-ink-100">
          {item.drawingNumber} <span className="text-ink-500">· {item.drawingTitle}</span>
        </div>
        <StatusBadge tone={EXTRACTION_STATUS_TONE[item.extractionStatus]} label={EXTRACTION_STATUS_LABELS[item.extractionStatus]} dot />
      </div>

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
