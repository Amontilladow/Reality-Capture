import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { StatusBadge } from '../ui/Badge';
import { apiErrorMessage } from '../../lib/api';
import {
  getSiteDrawing, listSiteDrawingRevisions, getSiteDrawingDownloadUrl, setSiteDrawingWorkflowStatus,
  startOfflinePackage, completeOfflinePackage, removeOfflinePackage, listOfflinePackages,
  SITE_DRAWING_WORKFLOW_STATUSES, type SiteDrawingWorkflowStatus, type SiteDrawingRevision,
} from '../../lib/site-drawings.api';
import { computeContentHash, saveOfflinePackage, deleteOfflinePackage } from '../../lib/site-drawings-offline';
import { SiteDrawingPdfViewer } from './SiteDrawingPdfViewer';
import { AddRevisionModal } from './AddRevisionModal';
import {
  WORKFLOW_STATUS_LABELS, WORKFLOW_STATUS_TONE, sourceProviderLabel, formatVerifiedAt, formatDate, formatFileSize,
  needsApprovalWarning, isConfirmedCurrent,
} from './siteDrawingDisplay';
import { useAuthStore } from '../../store/auth.store';

// Status controls are shown to any signed-in viewer -- there's no
// company-role -> OrgCategory mapping on the frontend to gate them with
// precisely (the real matrix lives server-side in org-permission.types.ts),
// and the brief itself warns against relying on a hidden button as the
// actual access control. The real gate is the API's own
// RequireCategoryAction('drawings', 'approve', ...) guard; an unauthorized
// attempt here just surfaces that 403 through the existing error display.
export function SiteDrawingDetailDrawer({ projectId, drawingId, onClose }: {
  projectId: string; drawingId: string; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [addRevisionOpen, setAddRevisionOpen] = useState(false);
  const [tab, setTab] = useState<'viewer' | 'history'>('viewer');
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState('');
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [offlineError, setOfflineError] = useState('');

  const drawingQuery = useQuery({ queryKey: ['site-drawing', projectId, drawingId], queryFn: () => getSiteDrawing(projectId, drawingId) });
  const revisionsQuery = useQuery({ queryKey: ['site-drawing-revisions', projectId, drawingId], queryFn: () => listSiteDrawingRevisions(projectId, drawingId) });
  const offlinePackagesQuery = useQuery({ queryKey: ['site-drawing-offline-packages', projectId], queryFn: () => listOfflinePackages(projectId) });

  const drawing = drawingQuery.data;
  const revision = drawing?.currentRevision ?? null;
  const offlinePackage = offlinePackagesQuery.data?.find((p) => p.revisionId === revision?.id);

  const statusMutation = useMutation({
    mutationFn: (status: SiteDrawingWorkflowStatus) => {
      if (!revision) throw new Error('No revision to update.');
      return setSiteDrawingWorkflowStatus(projectId, drawingId, revision.id, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-drawing', projectId, drawingId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawing-revisions', projectId, drawingId] });
      queryClient.invalidateQueries({ queryKey: ['site-drawings', projectId] });
    },
  });

  async function openViewer(rev: SiteDrawingRevision) {
    setViewerError('');
    setViewerUrl(null);
    try {
      const { url } = await getSiteDrawingDownloadUrl(projectId, rev.id);
      setViewerUrl(url);
    } catch (err) {
      setViewerError(apiErrorMessage(err));
    }
  }

  // Explicit, opt-in download (brief section 8) -- fetches the file once
  // through the same short-lived authorized URL the viewer uses, verifies
  // its integrity against the server's own content hash when one exists,
  // and only reports COMPLETE if the bytes actually arrived intact. A
  // failed or interrupted download is reported FAILED, never silently
  // treated as success.
  async function downloadForOffline() {
    if (!revision) return;
    setOfflineError('');
    setOfflineBusy(true);
    const pkg = await startOfflinePackage(projectId, revision.id).catch((err) => {
      setOfflineError(apiErrorMessage(err));
      setOfflineBusy(false);
      return null;
    });
    if (!pkg) return;
    try {
      const { url } = await getSiteDrawingDownloadUrl(projectId, revision.id);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const contentHash = await computeContentHash(blob);
      if (revision.contentHash && revision.contentHash !== contentHash) {
        throw new Error('Downloaded file failed integrity verification.');
      }
      await saveOfflinePackage({ packageId: pkg.id, revisionId: revision.id, drawingId, blob, contentHash, fileSizeBytes: blob.size });
      await completeOfflinePackage(projectId, pkg.id, 'COMPLETE', contentHash, blob.size);
    } catch (err) {
      await completeOfflinePackage(projectId, pkg.id, 'FAILED').catch(() => {});
      setOfflineError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setOfflineBusy(false);
      queryClient.invalidateQueries({ queryKey: ['site-drawing-offline-packages', projectId] });
    }
  }

  async function removeOffline() {
    if (!offlinePackage) return;
    setOfflineBusy(true);
    await deleteOfflinePackage(offlinePackage.id).catch(() => {});
    await removeOfflinePackage(projectId, offlinePackage.id).catch(() => {});
    setOfflineBusy(false);
    queryClient.invalidateQueries({ queryKey: ['site-drawing-offline-packages', projectId] });
  }

  return (
    <>
      <Modal open onClose={onClose} title={drawing?.drawingTitle ?? 'Drawing'} wide>
        {!drawing ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : (
          <div className="space-y-4">
            {/* Identifier, revision, status, source, verification -- all visible without leaving this view (brief section 7) */}
            <div className="panel p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <div><span className="text-xs text-ink-500 block">Drawing No.</span>{drawing.drawingNumber}</div>
              <div><span className="text-xs text-ink-500 block">Revision</span>{revision?.revisionNumber ?? '—'}</div>
              <div>
                <span className="text-xs text-ink-500 block">Status</span>
                {revision ? <StatusBadge tone={WORKFLOW_STATUS_TONE[revision.workflowStatus]} label={WORKFLOW_STATUS_LABELS[revision.workflowStatus]} dot /> : '—'}
              </div>
              <div><span className="text-xs text-ink-500 block">Source</span>{sourceProviderLabel(drawing.sourceProvider)}</div>
              <div><span className="text-xs text-ink-500 block">Last verified</span>{revision ? formatVerifiedAt(revision.lastVerifiedAt) : '—'}</div>
              {revision?.isSuperseded && <StatusBadge tone="neutral" label="Superseded" />}
            </div>

            {revision && needsApprovalWarning(revision.workflowStatus) && (
              <div className="panel p-3 border border-warn/40 bg-warn/5 text-xs text-ink-100">
                ⚠ This revision's approval status is {revision.workflowStatus === 'UNKNOWN' ? 'unverified' : 'still under review'} — do not treat it as confirmed current for construction.
              </div>
            )}
            {revision && revision.isSuperseded && (
              <div className="panel p-3 border border-base-500 bg-base-800/60 text-xs text-ink-300">
                A newer revision supersedes this one. Open the Revision History tab to find the current revision.
              </div>
            )}

            {revision && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-ink-500">Set status:</span>
                {SITE_DRAWING_WORKFLOW_STATUSES.map((s) => (
                  <button
                    key={s} onClick={() => statusMutation.mutate(s)} disabled={statusMutation.isPending}
                    className={`btn-secondary !px-2.5 !py-1 text-xs ${revision.workflowStatus === s ? '!bg-blueprint/20 !text-blueprint' : ''}`}
                  >
                    {WORKFLOW_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
            {statusMutation.isError && <p className="field-error">{apiErrorMessage(statusMutation.error)}</p>}

            <div className="flex items-center gap-2 border-b border-base-600">
              <button onClick={() => setTab('viewer')} className={`px-3 py-2 text-sm ${tab === 'viewer' ? 'border-b-2 border-blueprint text-blueprint' : 'text-ink-500 hover:text-ink-100'}`}>Viewer</button>
              <button onClick={() => setTab('history')} className={`px-3 py-2 text-sm ${tab === 'history' ? 'border-b-2 border-blueprint text-blueprint' : 'text-ink-500 hover:text-ink-100'}`}>Revision History</button>
              <div className="ml-auto flex items-center gap-2 py-1.5">
                {revision && (
                  <button onClick={() => setAddRevisionOpen(true)} className="btn-secondary !px-2.5 !py-1 text-xs">Add revision</button>
                )}
              </div>
            </div>

            {tab === 'viewer' && (
              <div className="space-y-2">
                {!viewerUrl && !viewerError && revision && (
                  <div className="panel p-8 text-center">
                    <button onClick={() => openViewer(revision)} className="btn-primary">Open PDF</button>
                  </div>
                )}
                {viewerError && <p className="field-error">{viewerError}</p>}
                {viewerUrl && (
                  <div className="panel tick-frame" style={{ height: 520 }}>
                    <SiteDrawingPdfViewer fileUrl={viewerUrl} />
                  </div>
                )}

                {/* Offline (brief section 8) -- unmistakable indicator + last-verified timestamp */}
                {revision && (
                  <div className="panel p-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-xs text-ink-500">
                      {offlinePackage?.status === 'COMPLETE' && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="badge bg-ok/15 text-ok">OFFLINE AVAILABLE</span>
                          {formatVerifiedAt(offlinePackage.lastVerifiedAt)} · {formatFileSize(offlinePackage.fileSizeBytes)}
                        </span>
                      )}
                      {offlinePackage?.status === 'STALE' && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="badge bg-warn/15 text-warn">OFFLINE COPY OUTDATED</span>
                          A newer revision exists — remove and re-download.
                        </span>
                      )}
                      {!offlinePackage && !revision.offlineEligibility && 'Not eligible for offline download.'}
                      {!offlinePackage && revision.offlineEligibility && 'Not downloaded for offline use.'}
                    </div>
                    <div className="flex items-center gap-2">
                      {offlinePackage && offlinePackage.status !== 'REMOVED' ? (
                        <button onClick={removeOffline} disabled={offlineBusy} className="btn-ghost !px-2.5 !py-1 text-xs">Remove offline copy</button>
                      ) : (
                        revision.offlineEligibility && user && (
                          <button onClick={downloadForOffline} disabled={offlineBusy} className="btn-secondary !px-2.5 !py-1 text-xs">
                            {offlineBusy ? 'Downloading…' : 'Download for offline'}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}
                {offlineError && <p className="field-error">{offlineError}</p>}
              </div>
            )}

            {tab === 'history' && (
              <div className="panel tick-frame divide-y divide-base-700/60">
                {(revisionsQuery.data ?? []).map((r) => (
                  <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-sm text-ink-100 flex items-center gap-2">
                        Rev {r.revisionNumber}
                        {isConfirmedCurrent(r.workflowStatus, r.isSuperseded) && <StatusBadge tone="info" label="Current" />}
                        {r.isSuperseded && <StatusBadge tone="neutral" label="Superseded" />}
                      </div>
                      <div className="text-xs text-ink-500 mt-0.5">
                        Issued {formatDate(r.issueDate)} · {formatFileSize(r.fileSizeBytes)} · {formatVerifiedAt(r.lastVerifiedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={WORKFLOW_STATUS_TONE[r.workflowStatus]} label={WORKFLOW_STATUS_LABELS[r.workflowStatus]} dot />
                      <button onClick={() => { setTab('viewer'); openViewer(r); }} className="btn-ghost !px-2 !py-1 text-xs">View</button>
                    </div>
                  </div>
                ))}
                {(revisionsQuery.data?.length ?? 0) === 0 && <div className="px-4 py-8 text-center text-sm text-ink-500">No revisions yet.</div>}
              </div>
            )}
          </div>
        )}
      </Modal>

      {addRevisionOpen && drawing && (
        <AddRevisionModal open onClose={() => setAddRevisionOpen(false)} projectId={projectId} drawingId={drawingId} drawingTitle={drawing.drawingTitle} />
      )}
    </>
  );
}
