import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { PageHeader } from '../components/layout/PageHeader';
import { getReportKpis } from '../lib/reports.api';
import { downloadReportsXls } from '../lib/reports-xls';
import { getProject } from '../lib/projects.api';
import { listDocuments, uploadDocumentFile } from '../lib/documents.api';
import { apiErrorMessage, apiDownload } from '../lib/api';
import {
  STATUS_LABELS, PRIORITY_LABELS, DISCIPLINE_LABELS, formatDateTime,
} from '../lib/issue-constants';
import { SNAG_STATUS_LABELS, SNAG_PRIORITY_LABELS } from '../lib/snagging-constants';

// Recharts marks need real hex/rgb colors -- they don't inherit Tailwind
// classes -- pulled straight from tailwind.config.js's "Blueprint-dark
// technical" palette rather than invented, so this page's charts read as the
// same product as the badges on the Issues/Snagging tabs themselves.
const HEX = {
  blueprint: '#4FB6E8',
  signal: '#FF7A29',
  ok: '#4ADE80',
  warn: '#FBBF24',
  danger: '#F87171',
  base600: '#324656',
  ink500: '#7E8F9C',
  base800: '#182631',
  base700: '#22323F',
};

// Mirrors STATUS_BADGE_CLASS / SNAG_STATUS_BADGE_CLASS's own color choices
// (issue-constants.ts / snagging-constants.ts) so a given status reads as
// the same color here as it does on the live tabs.
const ISSUE_STATUS_COLORS: Record<string, string> = {
  open: HEX.blueprint,
  assigned: HEX.warn,
  in_progress: HEX.warn,
  under_review: HEX.warn,
  waiting_for_information: HEX.warn,
  resolved: HEX.ok,
  closed: HEX.ink500,
  reopened: HEX.danger,
  void: HEX.ink500,
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: HEX.danger,
  high: HEX.danger,
  medium: HEX.warn,
  low: HEX.ink500,
};

const SNAG_STATUS_COLORS: Record<string, string> = {
  open: HEX.danger,
  fixed: HEX.warn,
  verified: HEX.ok,
  void: HEX.ink500,
};

// Rotating palette for axes with no fixed status/priority meaning
// (discipline, trade) -- reuses the same accent colors as everything else
// on this page instead of inventing a new chart palette.
const SERIES_PALETTE = [HEX.blueprint, HEX.signal, HEX.ok, HEX.warn, HEX.danger, HEX.ink500];

function countsToChartData(counts: Record<string, number>, labelFor: (key: string) => string) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, name: labelFor(key), value: count }));
}

const TOOLTIP_STYLE = {
  background: HEX.base800,
  border: `1px solid ${HEX.base700}`,
  borderRadius: 4,
  fontSize: 12,
  color: '#EAF0F4',
};

export default function ReportsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const kpisQuery = useQuery({
    queryKey: ['report-kpis', projectId],
    queryFn: () => getReportKpis(projectId!),
    enabled: Boolean(projectId),
  });

  const documentsQuery = useQuery({
    queryKey: ['documents', projectId, 'report_attachment'],
    queryFn: () => listDocuments(projectId!, { perPage: 100, docType: 'report_attachment' }),
    enabled: Boolean(projectId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocumentFile(projectId!, file, { docType: 'report_attachment', title: file.name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', projectId, 'report_attachment'] });
    },
  });

  const [xlsError, setXlsError] = useState('');
  const [xlsDownloading, setXlsDownloading] = useState(false);
  async function handleDownloadXls() {
    if (!kpisQuery.data) return;
    setXlsError('');
    setXlsDownloading(true);
    try {
      await downloadReportsXls(kpisQuery.data, projectQuery.data?.code ?? projectId!);
    } catch (err) {
      setXlsError(apiErrorMessage(err));
    } finally {
      setXlsDownloading(false);
    }
  }

  const [pdfError, setPdfError] = useState('');
  const [pdfDownloading, setPdfDownloading] = useState(false);
  async function handleDownloadPdf() {
    if (!projectId) return;
    setPdfError('');
    setPdfDownloading(true);
    try {
      await apiDownload(`/projects/${projectId}/reports/pdf`, `${projectQuery.data?.code ?? projectId}-report.pdf`);
    } catch (err) {
      setPdfError(apiErrorMessage(err));
    } finally {
      setPdfDownloading(false);
    }
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = '';
  }

  if (!projectId) return null;

  const kpis = kpisQuery.data;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="Reports"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={handleDownloadXls} disabled={!kpis || xlsDownloading} className="btn-secondary">
              {xlsDownloading ? 'Preparing…' : 'Export as Excel'}
            </button>
            <button onClick={handleDownloadPdf} disabled={pdfDownloading} className="btn-primary">
              {pdfDownloading ? 'Preparing…' : 'Export as PDF'}
            </button>
          </div>
        }
      />

      <div className="p-6 space-y-8">
        {(xlsError || pdfError) && (
          <div className="space-y-1">
            {xlsError && <p className="field-error">{xlsError}</p>}
            {pdfError && <p className="field-error">{pdfError}</p>}
          </div>
        )}

        {kpisQuery.isLoading && <p className="text-sm text-ink-500">Loading report data…</p>}
        {kpisQuery.isError && <p className="field-error">{apiErrorMessage(kpisQuery.error)}</p>}

        {kpis && (
          <>
            {/* ── Issues ─────────────────────────────────────────────── */}
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Issues</h2>

              <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
                <StatTile label="Total" value={kpis.issues.summary.total} />
                <StatTile label="Open" value={kpis.issues.summary.open} />
                <StatTile label="In Progress" value={kpis.issues.summary.inProgress} />
                <StatTile label="Resolved" value={kpis.issues.summary.resolved} />
                <StatTile label="Closed" value={kpis.issues.summary.closed} />
                <StatTile label="Critical" value={kpis.issues.summary.critical} tone="danger" />
                <StatTile label="Overdue" value={kpis.issues.summary.overdue} tone="danger" />
              </div>

              {kpis.issues.summary.total === 0 ? (
                <div className="panel tick-frame p-10 text-center text-sm text-ink-500">
                  No issues logged on this project yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <ChartCard title="By status">
                    <StatusPieChart data={countsToChartData(kpis.issues.byStatus, (k) => STATUS_LABELS[k as keyof typeof STATUS_LABELS] ?? k)} colorFor={(k) => ISSUE_STATUS_COLORS[k] ?? HEX.ink500} />
                  </ChartCard>
                  <ChartCard title="By priority">
                    <CountBarChart data={countsToChartData(kpis.issues.byPriority, (k) => PRIORITY_LABELS[k as keyof typeof PRIORITY_LABELS] ?? k)} colorFor={(k) => PRIORITY_COLORS[k] ?? HEX.blueprint} />
                  </ChartCard>
                  <ChartCard title="By discipline">
                    <CountBarChart data={countsToChartData(kpis.issues.byDiscipline, (k) => DISCIPLINE_LABELS[k as keyof typeof DISCIPLINE_LABELS] ?? k)} colorFor={(_k, i) => SERIES_PALETTE[i % SERIES_PALETTE.length]} />
                  </ChartCard>
                </div>
              )}

              {kpis.issues.openList.length > 0 && (
                <div className="panel tick-frame overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                        <th className="px-4 py-2.5 font-medium">Number</th>
                        <th className="px-4 py-2.5 font-medium">Title</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Priority</th>
                        <th className="px-4 py-2.5 font-medium">Assigned to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpis.issues.openList.map((item) => (
                        <tr key={item.id} className="border-b border-base-700/60 last:border-0">
                          <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{item.issueNumber ?? item.id.slice(0, 8)}</td>
                          <td className="px-4 py-2.5">{item.title}</td>
                          <td className="px-4 py-2.5 text-ink-300">{STATUS_LABELS[item.status as keyof typeof STATUS_LABELS] ?? item.status}</td>
                          <td className="px-4 py-2.5 text-ink-300">{PRIORITY_LABELS[item.priority as keyof typeof PRIORITY_LABELS] ?? item.priority}</td>
                          <td className="px-4 py-2.5 text-ink-500">{item.assignedToName ?? 'Unassigned'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ── Snagging ───────────────────────────────────────────── */}
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Snagging</h2>

              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                <StatTile label="Total" value={kpis.snagging.summary.total} />
                <StatTile label="Open" value={kpis.snagging.summary.open} />
                <StatTile label="Fixed" value={kpis.snagging.summary.fixed} />
                <StatTile label="Verified" value={kpis.snagging.summary.verified} />
                <StatTile label="Overdue" value={kpis.snagging.summary.overdue} tone="danger" />
              </div>

              {kpis.snagging.summary.total === 0 ? (
                <div className="panel tick-frame p-10 text-center text-sm text-ink-500">
                  No snag items logged on this project yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <ChartCard title="By status">
                    <StatusPieChart data={countsToChartData(kpis.snagging.byStatus, (k) => SNAG_STATUS_LABELS[k as keyof typeof SNAG_STATUS_LABELS] ?? k)} colorFor={(k) => SNAG_STATUS_COLORS[k] ?? HEX.ink500} />
                  </ChartCard>
                  <ChartCard title="By priority">
                    <CountBarChart data={countsToChartData(kpis.snagging.byPriority, (k) => SNAG_PRIORITY_LABELS[k as keyof typeof SNAG_PRIORITY_LABELS] ?? k)} colorFor={(k) => PRIORITY_COLORS[k] ?? HEX.blueprint} />
                  </ChartCard>
                  <ChartCard title="By trade">
                    <CountBarChart data={countsToChartData(kpis.snagging.byTrade, (k) => k)} colorFor={(_k, i) => SERIES_PALETTE[i % SERIES_PALETTE.length]} />
                  </ChartCard>
                </div>
              )}

              {kpis.snagging.openList.length > 0 && (
                <div className="panel tick-frame overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                        <th className="px-4 py-2.5 font-medium">Number</th>
                        <th className="px-4 py-2.5 font-medium">Title</th>
                        <th className="px-4 py-2.5 font-medium">Trade</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Priority</th>
                        <th className="px-4 py-2.5 font-medium">Assigned to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpis.snagging.openList.map((item) => (
                        <tr key={item.id} className="border-b border-base-700/60 last:border-0">
                          <td className="px-4 py-2.5 font-mono text-xs text-ink-500">{item.snagNumber ?? item.id.slice(0, 8)}</td>
                          <td className="px-4 py-2.5">{item.title}</td>
                          <td className="px-4 py-2.5 text-ink-300">{item.trade ?? '—'}</td>
                          <td className="px-4 py-2.5 text-ink-300">{SNAG_STATUS_LABELS[item.status as keyof typeof SNAG_STATUS_LABELS] ?? item.status}</td>
                          <td className="px-4 py-2.5 text-ink-300">{SNAG_PRIORITY_LABELS[item.priority as keyof typeof SNAG_PRIORITY_LABELS] ?? item.priority}</td>
                          <td className="px-4 py-2.5 text-ink-500">{item.assignedToName ?? 'Unassigned'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {/* ── Uploaded documents ───────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Uploaded documents</h2>
            <div>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChosen} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                className="btn-secondary !px-3 !py-1.5 text-xs"
              >
                {uploadMutation.isPending ? 'Uploading…' : '+ Upload attachment'}
              </button>
            </div>
          </div>

          {uploadMutation.isError && <p className="field-error">{apiErrorMessage(uploadMutation.error)}</p>}

          {documentsQuery.isLoading && <p className="text-sm text-ink-500">Loading…</p>}

          {documentsQuery.data?.data.length === 0 && !documentsQuery.isLoading && (
            <div className="tick-frame panel p-8 text-center text-sm text-ink-500">
              No report attachments uploaded yet.
            </div>
          )}

          {(documentsQuery.data?.data.length ?? 0) > 0 && (
            <div className="panel tick-frame overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                    <th className="px-4 py-2.5 font-medium">Title</th>
                    <th className="px-4 py-2.5 font-medium">Uploaded by</th>
                    <th className="px-4 py-2.5 font-medium">Uploaded at</th>
                  </tr>
                </thead>
                <tbody>
                  {(documentsQuery.data?.data ?? []).map((d) => (
                    <tr key={d.id} className="border-b border-base-700/60 last:border-0">
                      <td className="px-4 py-2.5">{d.title}</td>
                      <td className="px-4 py-2.5 text-ink-500">{(d as unknown as { uploadedByName?: string }).uploadedByName ?? '—'}</td>
                      <td className="px-4 py-2.5 text-ink-500">{formatDateTime(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="panel p-3 text-left">
      <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-0.5">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === 'danger' && value > 0 ? 'text-danger' : 'text-ink-100'}`}>
        {value}
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="field-label !mb-2">{title}</div>
      <div style={{ width: '100%', height: 220 }}>{children}</div>
    </div>
  );
}

function StatusPieChart({ data, colorFor }: { data: { key: string; name: string; value: number }[]; colorFor: (key: string) => string }) {
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} paddingAngle={2}>
          {data.map((entry) => (
            <Cell key={entry.key} fill={colorFor(entry.key)} stroke={HEX.base800} strokeWidth={1} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function CountBarChart({ data, colorFor }: { data: { key: string; name: string; value: number }[]; colorFor: (key: string, index: number) => string }) {
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={HEX.base700} vertical={false} />
        <XAxis dataKey="name" tick={{ fill: HEX.ink500, fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
        <YAxis tick={{ fill: HEX.ink500, fontSize: 10 }} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(79,182,232,0.08)' }} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={entry.key} fill={colorFor(entry.key, i)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyChart() {
  return <div className="h-full flex items-center justify-center text-xs text-ink-500">No data</div>;
}
