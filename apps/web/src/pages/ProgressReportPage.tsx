import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { Modal } from '../components/ui/Modal';
import { getProject, getHierarchy } from '../lib/projects.api';
import {
  getProgressReport, downloadProgressReportPdf, createProgressReportShare,
  listProgressReportShares, revokeProgressReportShare,
  type ProgressReportFilters, type ProgressReportIssueRow, type ProgressReport,
} from '../lib/progress-reports.api';
import { apiErrorMessage } from '../lib/api';

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="panel p-3 text-left">
      <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-0.5">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === 'danger' && value > 0 ? 'text-danger' : 'text-ink-100'}`}>{value}</div>
    </div>
  );
}

function ElementProgressSection({ elementProgress }: { elementProgress: ProgressReport['elementProgress'] }) {
  if (!elementProgress || elementProgress.byLevel.length === 0) return null;
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">
        Planned vs Actual Progress ({elementProgress.overallCompletionPct ?? 0}% complete)
      </h2>
      <div className="panel tick-frame overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-500 border-b border-base-600">
              <th className="px-4 py-2.5 font-medium">Level</th>
              <th className="px-4 py-2.5 font-medium">Building</th>
              <th className="px-4 py-2.5 font-medium">Elements</th>
              <th className="px-4 py-2.5 font-medium">Complete</th>
              <th className="px-4 py-2.5 font-medium">Zone Status</th>
            </tr>
          </thead>
          <tbody>
            {elementProgress.byLevel.map((lvl) => (
              <tr key={lvl.levelId} className="border-b border-base-700/60 last:border-0">
                <td className="px-4 py-2.5">{lvl.levelName}</td>
                <td className="px-4 py-2.5 text-ink-500">{lvl.buildingName}</td>
                <td className="px-4 py-2.5 text-ink-300">{lvl.elementComplete}/{lvl.elementTotal}</td>
                <td className="px-4 py-2.5 text-ink-300">{lvl.elementCompletionPct ?? 0}%</td>
                <td className="px-4 py-2.5 text-ink-500">{lvl.zoneStatus ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IssueSection({ title, items, emptyText }: { title: string; items: ProgressReportIssueRow[]; emptyText: string }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">{title} ({items.length})</h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-500">{emptyText}</p>
      ) : (
        <div className="panel tick-frame overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                <th className="px-4 py-2.5 font-medium">Number</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Priority</th>
                <th className="px-4 py-2.5 font-medium">Location</th>
                <th className="px-4 py-2.5 font-medium">Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-base-700/60 last:border-0">
                  <td className="px-4 py-2.5 text-ink-500">{item.issueNumber}</td>
                  <td className="px-4 py-2.5">{item.title}</td>
                  <td className="px-4 py-2.5 text-ink-300">{item.status}</td>
                  <td className="px-4 py-2.5 text-ink-300">{item.priority}</td>
                  <td className="px-4 py-2.5 text-ink-500">{item.locationName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-ink-500">{item.assignedToName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ProgressReportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [dateFrom, setDateFrom] = useState(isoDateDaysAgo(7));
  const [dateTo, setDateTo] = useState(isoDateDaysAgo(0));
  const [buildingId, setBuildingId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [shareOpen, setShareOpen] = useState(false);

  const projectQuery = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId!), enabled: Boolean(projectId) });
  const hierarchyQuery = useQuery({ queryKey: ['hierarchy', projectId], queryFn: () => getHierarchy(projectId!), enabled: Boolean(projectId) });

  const filters: ProgressReportFilters = {
    dateFrom: new Date(`${dateFrom}T00:00:00`).toISOString(),
    dateTo: new Date(`${dateTo}T23:59:59`).toISOString(),
    buildingId: buildingId || undefined,
    levelId: levelId || undefined,
  };

  const reportQuery = useQuery({
    queryKey: ['progress-report', projectId, filters.dateFrom, filters.dateTo, filters.buildingId, filters.levelId],
    queryFn: () => getProgressReport(projectId!, filters),
    enabled: Boolean(projectId),
  });

  const [pdfError, setPdfError] = useState('');
  const [pdfDownloading, setPdfDownloading] = useState(false);
  async function handleDownloadPdf() {
    if (!projectId) return;
    setPdfError('');
    setPdfDownloading(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadProgressReportPdf(projectId, filters, `${projectQuery.data?.code ?? projectId}-progress-report-${date}.pdf`);
    } catch (err) {
      setPdfError(apiErrorMessage(err));
    } finally {
      setPdfDownloading(false);
    }
  }

  const selectedBuilding = hierarchyQuery.data?.find((b) => b.id === buildingId);
  const levelOptions = selectedBuilding?.levels ?? [];
  const report = reportQuery.data;

  if (!projectId) return null;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="Progress Report"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={handleDownloadPdf} disabled={!report || pdfDownloading} className="btn-secondary">
              {pdfDownloading ? 'Preparing…' : 'Download PDF'}
            </button>
            <button onClick={() => setShareOpen(true)} className="btn-primary">Share</button>
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {pdfError && <p className="field-error">{pdfError}</p>}

        <div className="panel p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="field-label" htmlFor="pr-from">From</label>
            <input id="pr-from" type="date" className="field-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} max={dateTo} />
          </div>
          <div>
            <label className="field-label" htmlFor="pr-to">To</label>
            <input id="pr-to" type="date" className="field-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} min={dateFrom} max={isoDateDaysAgo(0)} />
          </div>
          <div>
            <label className="field-label" htmlFor="pr-building">Building</label>
            <select
              id="pr-building" className="field-input" value={buildingId}
              onChange={(e) => { setBuildingId(e.target.value); setLevelId(''); }}
            >
              <option value="">All buildings</option>
              {(hierarchyQuery.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="pr-level">Level</label>
            <select id="pr-level" className="field-input" value={levelId} disabled={!buildingId} onChange={(e) => setLevelId(e.target.value)}>
              <option value="">{buildingId ? 'All levels' : 'Any level'}</option>
              {levelOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>

        {reportQuery.isLoading && <p className="text-sm text-ink-500">Generating report…</p>}
        {reportQuery.isError && <p className="field-error">{apiErrorMessage(reportQuery.error)}</p>}

        {report && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <StatTile label="Captures" value={report.captureCount} />
              <StatTile label="New Issues" value={report.newIssues.length} />
              <StatTile label="Closed Issues" value={report.closedIssues.length} />
              <StatTile label="Overdue Issues" value={report.overdueIssues.length} tone="danger" />
              <StatTile label="Blockers" value={report.blockers.length} tone="danger" />
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">
                Captures {report.captureCount > report.captures.length ? `(showing ${report.captures.length} of ${report.captureCount})` : `(${report.captures.length})`}
              </h2>
              {report.captures.length === 0 ? (
                <p className="text-sm text-ink-500">No captures in this date range.</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  {report.captures.map((c) => (
                    <div key={c.id} className="space-y-1">
                      {c.thumbnailUrl
                        ? <img src={c.thumbnailUrl} alt="" className="w-full h-24 object-cover rounded border border-base-600" />
                        : <div className="w-full h-24 rounded bg-base-800 border border-base-600" />}
                      <div className="text-[10px] text-ink-500 truncate">{c.locationName ?? c.title ?? 'Capture'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <ElementProgressSection elementProgress={report.elementProgress} />

            <IssueSection title="New Issues" items={report.newIssues} emptyText="No new issues in this date range." />
            <IssueSection title="Closed Issues" items={report.closedIssues} emptyText="No issues closed in this date range." />
            <IssueSection title="Overdue Issues" items={report.overdueIssues} emptyText="No overdue issues." />
            <IssueSection title="Blockers" items={report.blockers} emptyText="No critical/high-priority open issues." />
          </>
        )}
      </div>

      {shareOpen && (
        <ShareModal projectId={projectId} filters={filters} onClose={() => setShareOpen(false)} queryClient={queryClient} />
      )}
    </>
  );
}

// Mirrors the RFI external-access UI pattern (RfiDetailPage.tsx): a form to
// generate a link, a readonly URL + Copy button on success, a WhatsApp
// `wa.me` deep link (no WhatsApp Business API -- out of scope per the
// brief), and a list of previously issued links with revoke.
function ShareModal({
  projectId, filters, onClose, queryClient,
}: {
  projectId: string;
  filters: ProgressReportFilters;
  onClose: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [copied, setCopied] = useState(false);

  const sharesQuery = useQuery({ queryKey: ['progress-report-shares', projectId], queryFn: () => listProgressReportShares(projectId) });

  const createMutation = useMutation({
    mutationFn: () => createProgressReportShare(projectId, filters, expiresInDays),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress-report-shares', projectId] }),
  });

  const revokeMutation = useMutation({
    mutationFn: (shareId: string) => revokeProgressReportShare(projectId, shareId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress-report-shares', projectId] }),
  });

  async function handleCopy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const now = Date.now();

  return (
    <Modal open onClose={onClose} title="Share Progress Report" wide>
      <div className="space-y-4">
        <p className="text-xs text-ink-500">
          Generates a public link for the report with your current filters (date range{filters.buildingId ? ', building' : ''}{filters.levelId ? ', level' : ''}).
          Anyone with the link can view it, logged out, until it expires or is revoked. No email is sent automatically — copy the link yourself.
        </p>

        <div className="flex items-end gap-2">
          <div>
            <label className="field-label" htmlFor="share-expiry">Expires in (days)</label>
            <input
              id="share-expiry" type="number" min={1} max={90} className="field-input w-28"
              value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))}
            />
          </div>
          <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="btn-primary">
            {createMutation.isPending ? 'Generating…' : 'Generate link'}
          </button>
        </div>
        {createMutation.isError && <p className="field-error">{apiErrorMessage(createMutation.error)}</p>}

        {createMutation.data && (
          <div className="panel p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input readOnly value={createMutation.data.shareUrl} className="field-input flex-1 text-xs" onFocus={(e) => e.target.select()} />
              <button onClick={() => handleCopy(createMutation.data!.shareUrl)} className="btn-secondary !px-3 !py-1.5 text-xs">
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(createMutation.data.shareUrl)}`}
                target="_blank" rel="noopener noreferrer"
                className="btn-secondary !px-3 !py-1.5 text-xs"
              >
                Share on WhatsApp
              </a>
            </div>
          </div>
        )}

        <div>
          <div className="field-label !mb-2">Active and past links</div>
          {(sharesQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-500">No share links generated yet.</p>
          ) : (
            <div className="panel tick-frame divide-y divide-base-700/60">
              {(sharesQuery.data ?? []).map((s) => {
                const expired = new Date(s.expiresAt).getTime() <= now;
                const status = s.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Active';
                return (
                  <div key={s.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <span className={`badge ${status === 'Active' ? 'bg-ok/15 text-ok' : 'bg-base-700 text-ink-500'}`}>{status}</span>
                      <span className="text-ink-500 ml-2 text-xs">
                        {new Date(s.dateFrom).toLocaleDateString('en-GB')} – {new Date(s.dateTo).toLocaleDateString('en-GB')} · expires {new Date(s.expiresAt).toLocaleDateString('en-GB')}
                      </span>
                    </div>
                    {status === 'Active' && (
                      <button onClick={() => revokeMutation.mutate(s.id)} disabled={revokeMutation.isPending} className="btn-ghost !px-2 !py-1 text-xs text-danger">
                        Revoke
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
