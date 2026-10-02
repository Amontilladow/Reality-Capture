import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getProgressReportByToken, type ProgressReportIssueRow } from '../lib/progress-reports.api';
import { apiErrorMessage } from '../lib/api';

function IssueList({ title, items, emptyText }: { title: string; items: ProgressReportIssueRow[]; emptyText: string }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-ink-100 uppercase tracking-wide mb-2">{title} ({items.length})</h3>
      {items.length === 0 ? (
        <p className="text-sm text-ink-500">{emptyText}</p>
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm panel px-3 py-2">
              <div>
                <span className="text-ink-500 text-xs mr-2">{item.issueNumber}</span>
                <span className="text-ink-100">{item.title}</span>
              </div>
              <span className="text-xs text-ink-500">{item.locationName ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// No EngineeringOS account, no session -- the opaque token in the URL is the
// only credential. Deliberately outside ProtectedRoute/AppShell, same as
// RfiExternalPage -- nothing else in the app is reachable from here.
export default function ProgressReportExternalPage() {
  const { token } = useParams<{ token: string }>();

  const reportQuery = useQuery({
    queryKey: ['progress-report-external', token],
    queryFn: () => getProgressReportByToken(token!),
    enabled: Boolean(token),
    retry: false,
  });

  const report = reportQuery.data;

  return (
    <div className="min-h-screen bg-base-950 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none">
            <rect x="2" y="2" width="20" height="20" rx="2" stroke="#FF7A29" strokeWidth="1.5" />
            <path d="M2 8h20M8 2v20" stroke="#4FB6E8" strokeWidth="1" opacity="0.6" />
            <circle cx="8" cy="8" r="1.4" fill="#FF7A29" />
          </svg>
          <span className="font-semibold tracking-tight text-ink-100">EngineeringOS</span>
        </div>

        {reportQuery.isLoading && (
          <div className="panel tick-frame p-8 text-center text-sm text-ink-500">Loading…</div>
        )}

        {reportQuery.isError && (
          <div className="panel tick-frame p-8 text-center text-sm text-danger">{apiErrorMessage(reportQuery.error)}</div>
        )}

        {report && (
          <div className="panel tick-frame p-6">
            <div className="mb-6">
              <div className="text-xs text-ink-500 uppercase tracking-wide">
                {report.project.code ? `${report.project.name} · ${report.project.code}` : report.project.name}
                {report.building ? ` · ${report.building.name}` : ''}
                {report.level ? ` · ${report.level.name}` : ''}
              </div>
              <h1 className="text-xl font-semibold text-ink-100 mt-1">Progress Report</h1>
              <div className="text-xs text-ink-500 mt-1">
                {new Date(report.dateFrom).toLocaleDateString('en-GB')} – {new Date(report.dateTo).toLocaleDateString('en-GB')}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-6">
              {[
                { label: 'Captures', value: report.captureCount },
                { label: 'New Issues', value: report.newIssues.length },
                { label: 'Closed Issues', value: report.closedIssues.length },
                { label: 'Overdue', value: report.overdueIssues.length },
                { label: 'Blockers', value: report.blockers.length },
              ].map((t) => (
                <div key={t.label} className="panel p-3 text-center">
                  <div className="text-lg font-semibold text-ink-100 tabular-nums">{t.value}</div>
                  <div className="text-[10px] uppercase text-ink-500">{t.label}</div>
                </div>
              ))}
            </div>

            {report.captures.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-ink-100 uppercase tracking-wide mb-2">Captures</h3>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {report.captures.map((c) => (
                    <img key={c.id} src={c.thumbnailUrl} alt="" className="w-full h-20 object-cover rounded border border-base-600" />
                  ))}
                </div>
              </div>
            )}

            <IssueList title="New Issues" items={report.newIssues} emptyText="No new issues in this date range." />
            <IssueList title="Closed Issues" items={report.closedIssues} emptyText="No issues closed in this date range." />
            <IssueList title="Overdue Issues" items={report.overdueIssues} emptyText="No overdue issues." />
            <IssueList title="Blockers" items={report.blockers} emptyText="No critical/high-priority open issues." />
          </div>
        )}
      </div>
    </div>
  );
}
