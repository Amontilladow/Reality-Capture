import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { PageHeader } from '../components/layout/PageHeader';
import {
  getMyActivitySummary, getMyProductivityScore, getWorkforcePrivacySettings, attributeActivity,
} from '../lib/workforce.api';
import { listProjects } from '../lib/projects.api';
import { apiErrorMessage } from '../lib/api';

// Same "Blueprint-dark technical" palette used by ReportsPage's charts —
// recharts needs real hex values, it doesn't read Tailwind classes.
const HEX = {
  blueprint: '#4FB6E8',
  signal: '#FF7A29',
  ok: '#4ADE80',
  warn: '#FBBF24',
  danger: '#F87171',
  ink500: '#7E8F9C',
  base800: '#182631',
  base700: '#22323F',
};
const SERIES_PALETTE = [HEX.blueprint, HEX.signal, HEX.ok, HEX.warn, HEX.danger, HEX.ink500];
const TOOLTIP_STYLE = { background: HEX.base800, border: `1px solid ${HEX.base700}`, borderRadius: 4, fontSize: 12, color: '#EAF0F4' };

function formatHm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function WorkforcePage() {
  const queryClient = useQueryClient();
  const [attributingId, setAttributingId] = useState<string | null>(null);

  const summaryQuery = useQuery({ queryKey: ['workforce', 'activities', 'me'], queryFn: () => getMyActivitySummary() });
  const productivityQuery = useQuery({ queryKey: ['workforce', 'productivity', 'me'], queryFn: () => getMyProductivityScore() });
  const privacyQuery = useQuery({ queryKey: ['workforce', 'privacy-settings'], queryFn: getWorkforcePrivacySettings });
  const projectsQuery = useQuery({ queryKey: ['projects', 'all'], queryFn: () => listProjects({ perPage: 100 }) });

  const attributeMutation = useMutation({
    mutationFn: ({ activityId, projectId }: { activityId: string; projectId: string }) => attributeActivity(activityId, projectId),
    onSuccess: () => {
      setAttributingId(null);
      queryClient.invalidateQueries({ queryKey: ['workforce', 'activities', 'me'] });
    },
  });

  const summary = summaryQuery.data;
  const score = productivityQuery.data;
  const factors = score?.factors;

  const unattributed = (summary?.activities ?? []).filter((a) => !a.projectId).slice(0, 20);

  return (
    <>
      <PageHeader eyebrow="My Activity" title="Workforce" />

      <div className="p-6 space-y-8">
        {privacyQuery.data && (
          <p className="text-xs text-ink-500">
            Monitoring level: <span className="text-ink-300">{privacyQuery.data.monitoringLevel}</span> · Self-view{' '}
            <span className="text-ink-300">{privacyQuery.data.selfViewEnabled ? 'enabled' : 'disabled'}</span> · Screenshots{' '}
            <span className="text-ink-300">{privacyQuery.data.screenshotEnabled ? 'enabled' : 'not used'}</span> — this page shows only your own
            activity.
          </p>
        )}

        {(summaryQuery.isLoading || productivityQuery.isLoading) && <p className="text-sm text-ink-500">Loading your activity…</p>}
        {summaryQuery.isError && <p className="field-error">{apiErrorMessage(summaryQuery.error)}</p>}
        {productivityQuery.isError && <p className="field-error">{apiErrorMessage(productivityQuery.error)}</p>}

        {summary && (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Last 7 days</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatTile label="Tracked time" value={formatHm(summary.totalSeconds)} />
              <StatTile label="Productivity score" value={score ? `${score.score}` : '—'} tone="signal" />
              {factors && <StatTile label="Utilization" value={`${Math.round(factors.utilization * 100)}%`} />}
              {factors && <StatTile label="Engineering share" value={`${Math.round(factors.engineeringShare * 100)}%`} />}
            </div>

            {factors && (
              <p className="text-xs text-ink-500">
                Score factors (model {score?.modelVersion}) — utilization {Math.round(factors.utilization * 100)}%, engineering share{' '}
                {Math.round(factors.engineeringShare * 100)}%, from {formatHm(factors.totalActiveSeconds)} of active time. This is one explainable
                v1 formula, not a ranking — see the factors, not just the number.
              </p>
            )}

            {summary.totalSeconds === 0 ? (
              <div className="panel tick-frame p-10 text-center text-sm text-ink-500">
                No activity recorded yet. Activity appears here once a device is enrolled and reporting.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="By application">
                  <CountBarChart data={summary.byApplication.slice(0, 8).map((d) => ({ key: d.label, name: d.label, value: Math.round(d.seconds / 60) }))} />
                </ChartCard>
                <ChartCard title="By activity type">
                  <StatusPieChart data={summary.byActivityType.map((d) => ({ key: d.label, name: d.label, value: Math.round(d.seconds / 60) }))} />
                </ChartCard>
              </div>
            )}

            {summary.byProject.length > 0 && (
              <div className="panel tick-frame overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                      <th className="px-4 py-2.5 font-medium">Project</th>
                      <th className="px-4 py-2.5 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byProject.map((p) => (
                      <tr key={p.label} className="border-b border-base-700/60 last:border-0">
                        <td className="px-4 py-2.5">{p.label}</td>
                        <td className="px-4 py-2.5 text-ink-300 tabular-nums">{formatHm(p.seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {unattributed.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Unattributed activity</h2>
            <p className="text-xs text-ink-500">
              These activities have no confident project attribution yet. Assign one manually — a manual selection is always recorded at 100%
              confidence, since only you can say for certain.
            </p>
            <div className="panel tick-frame overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                    <th className="px-4 py-2.5 font-medium">Application</th>
                    <th className="px-4 py-2.5 font-medium">Duration</th>
                    <th className="px-4 py-2.5 font-medium">Project</th>
                  </tr>
                </thead>
                <tbody>
                  {unattributed.map((activity) => (
                    <tr key={activity.id} className="border-b border-base-700/60 last:border-0">
                      <td className="px-4 py-2.5">{activity.applicationName ?? activity.applicationNameRaw}</td>
                      <td className="px-4 py-2.5 text-ink-500 tabular-nums">{formatHm(activity.durationSeconds)}</td>
                      <td className="px-4 py-2.5">
                        <select
                          className="input !py-1 !text-xs"
                          value=""
                          disabled={attributingId === activity.id && attributeMutation.isPending}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            setAttributingId(activity.id);
                            attributeMutation.mutate({ activityId: activity.id, projectId: e.target.value });
                          }}
                        >
                          <option value="">Assign to project…</option>
                          {(projectsQuery.data?.data ?? []).map((project) => (
                            <option key={project.id} value={project.id}>{project.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {attributeMutation.isError && <p className="field-error">{apiErrorMessage(attributeMutation.error)}</p>}
          </section>
        )}
      </div>
    </>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'signal' }) {
  return (
    <div className="panel p-3 text-left">
      <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-0.5">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === 'signal' ? 'text-signal' : 'text-ink-100'}`}>{value}</div>
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

function StatusPieChart({ data }: { data: { key: string; name: string; value: number }[] }) {
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} paddingAngle={2}>
          {data.map((entry, i) => (
            <Cell key={entry.key} fill={SERIES_PALETTE[i % SERIES_PALETTE.length]} stroke={HEX.base800} strokeWidth={1} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function CountBarChart({ data }: { data: { key: string; name: string; value: number }[] }) {
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
            <Cell key={entry.key} fill={SERIES_PALETTE[i % SERIES_PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyChart() {
  return <div className="h-full flex items-center justify-center text-xs text-ink-500">No data yet</div>;
}
