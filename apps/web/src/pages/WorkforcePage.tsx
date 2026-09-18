import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { PageHeader } from '../components/layout/PageHeader';
import {
  getMyActivitySummary, getMyProductivityScore, getWorkforcePrivacySettings, attributeActivity,
  getMyTeam, listReportingLines, setReportingLine, updateWorkforcePrivacySettings, getMyScreenshots,
  listApplications, updateApplicationClassification,
} from '../lib/workforce.api';
import { listProjects } from '../lib/projects.api';
import { listUsers } from '../lib/users.api';
import { apiErrorMessage } from '../lib/api';
import { useAuthStore } from '../store/auth.store';
import {
  MONITORING_LEVELS, PRODUCTIVITY_CLASSIFICATIONS,
  type MonitoringLevel, type ProductivityClassification, type ProductivityFactors,
} from '@engineeringos/types';

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

// Renders '—' instead of "NaN%"/"NaNh NaNm" whenever a numeric field isn't
// actually a finite number -- a stale cache, a future backend change, or a
// malformed row must never surface raw NaN to the user (regardless of the
// fact that computeFactors() on the backend already guards its own
// divisions; this is the last line of defense, not a duplicate of that).
function pct(n: number | undefined | null): string {
  return typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—';
}

function formatHm(seconds: number | undefined | null): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// productivity_scores.score is a NUMERIC(5,2) column -- postgres.js returns
// NUMERIC as a string to avoid precision loss, so `score.score` may arrive
// as "0.00" (a string), not a number, despite the shared type declaring it
// as `number`. Coerce defensively rather than trusting the wire value.
function safeNumber(n: unknown): number | undefined {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN;
  return Number.isFinite(v) ? v : undefined;
}

export default function WorkforcePage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isCompanyAdmin = currentUser?.companyRole === 'company_admin' || currentUser?.companyRole === 'super_admin';

  const [attributingId, setAttributingId] = useState<string | null>(null);
  // null = viewing your own activity. Set to a team member's userId to
  // view theirs instead -- the backend enforces who's actually allowed to
  // see whom (self, weight-based leadership, or reporting-chain
  // visibility); this is just which one the page currently displays.
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const isSelf = selectedUserId === null;

  // Computed once (lazy initializer, not on every render) so both queries
  // below request the exact same window -- getMyActivitySummary() and
  // getMyProductivityScore() otherwise default to two different ranges
  // (trailing 7 days vs. ISO week-to-date) while sharing one "Last 7 days"
  // heading. Passing this explicit range to both keeps "Tracked time" and
  // "Productivity score"/"Utilization"/"Engineering share" honestly
  // describing the same period.
  const [{ from, to }] = useState(() => {
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from: fromDate.toISOString(), to: toDate.toISOString() };
  });

  const teamQuery = useQuery({ queryKey: ['workforce', 'team'], queryFn: getMyTeam });
  const selectedMember = teamQuery.data?.find((m) => m.userId === selectedUserId);

  const summaryQuery = useQuery({
    queryKey: ['workforce', 'activities', selectedUserId ?? 'me', from, to],
    queryFn: () => getMyActivitySummary({ from, to }, selectedUserId ?? undefined),
  });
  const productivityQuery = useQuery({
    queryKey: ['workforce', 'productivity', selectedUserId ?? 'me', from, to],
    queryFn: () => getMyProductivityScore({ from, to }, selectedUserId ?? undefined),
  });
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
  const scoreValue = score ? safeNumber(score.score) : undefined;

  // Manual project attribution only ever applies to your own activity
  // (POST /workforce/activities/:activityId/attribute is caller-scoped
  // server-side) -- never shown while viewing a team member's data.
  const unattributed = isSelf ? (summary?.activities ?? []).filter((a) => !a.projectId).slice(0, 20) : [];

  return (
    <>
      <PageHeader eyebrow={isSelf ? 'My Activity' : `${selectedMember?.name ?? 'Team member'}'s Activity`} title="Workforce" />

      <div className="p-6 space-y-8">
        {teamQuery.data && teamQuery.data.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Team</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedUserId(null)}
                className={`px-3 py-1.5 rounded text-xs border ${isSelf ? 'border-signal text-signal bg-signal/10' : 'border-base-600 text-ink-300 hover:bg-base-800'}`}
              >
                Me
              </button>
              {teamQuery.data.map((member) => (
                <button
                  key={member.userId}
                  onClick={() => setSelectedUserId(member.userId)}
                  className={`px-3 py-1.5 rounded text-xs border ${selectedUserId === member.userId ? 'border-signal text-signal bg-signal/10' : 'border-base-600 text-ink-300 hover:bg-base-800'}`}
                >
                  {member.name} <span className="text-ink-500">· {member.companyRole}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {privacyQuery.data && (
          <p className="text-xs text-ink-500">
            Monitoring level: <span className="text-ink-300">{privacyQuery.data.monitoringLevel}</span> · Self-view{' '}
            <span className="text-ink-300">{privacyQuery.data.selfViewEnabled ? 'enabled' : 'disabled'}</span> · Screenshots{' '}
            <span className="text-ink-300">{privacyQuery.data.screenshotEnabled ? 'enabled' : 'not used'}</span> —{' '}
            {isSelf
              ? 'this page shows only your own activity.'
              : `you're viewing ${selectedMember?.name ?? 'a team member'}'s activity as their manager or company leadership.`}
          </p>
        )}

        {(summaryQuery.isLoading || productivityQuery.isLoading) && <p className="text-sm text-ink-500">Loading activity…</p>}
        {summaryQuery.isError && <p className="field-error">{apiErrorMessage(summaryQuery.error)}</p>}
        {productivityQuery.isError && <p className="field-error">{apiErrorMessage(productivityQuery.error)}</p>}

        {summary && (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Last 7 days</h2>

            {summary.totalSeconds === 0 ? (
              <div className="panel tick-frame p-10 text-center text-sm text-ink-500">
                No activity recorded yet. Activity appears here once a device is enrolled and reporting.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <StatTile label="Tracked time" value={formatHm(summary.totalSeconds)} />
                  <StatTile label="Productivity score" value={scoreValue !== undefined ? scoreValue.toFixed(2) : '—'} tone="signal" />
                  {factors && <StatTile label="Utilization" value={pct(factors.utilization)} />}
                  {factors && <StatTile label="Engineering share" value={pct(factors.engineeringShare)} />}
                </div>

                {factors && (
                  <p className="text-xs text-ink-500">
                    Score factors (model {score?.modelVersion}) — utilization {pct(factors.utilization)}, engineering share{' '}
                    {pct(factors.engineeringShare)}, from {formatHm(factors.totalActiveSeconds)} of active time. This is one explainable
                    v1 formula, not a ranking — see the factors, not just the number.
                  </p>
                )}

                {factors?.productivityRatio !== undefined && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-ink-500">
                      <span>Productive time (by app classification)</span>
                      <span className="text-ink-300 tabular-nums">{pct(factors.productivityRatio)} productive</span>
                    </div>
                    <ProductivityBar factors={factors} />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <StatTile label="Productive" value={formatHm(factors.productiveSeconds)} tone="ok" />
                      <StatTile label="Neutral" value={formatHm(factors.neutralSeconds)} />
                      <StatTile label="Unproductive" value={formatHm(factors.unproductiveSeconds)} tone="danger" />
                      <StatTile label="Unclassified" value={formatHm(factors.unclassifiedSeconds)} tone="warn" />
                    </div>
                    {(factors.unclassifiedSeconds ?? 0) > 0 && isCompanyAdmin && (
                      <p className="text-xs text-ink-500">
                        Some time is in apps nobody has classified yet — see "Application productivity (admin)" below.
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ChartCard title="By application">
                    <CountBarChart data={summary.byApplication.slice(0, 8).map((d) => ({ key: d.label, name: d.label, value: Math.round(d.seconds / 60) }))} />
                  </ChartCard>
                  <ChartCard title="By activity type">
                    <StatusPieChart data={summary.byActivityType.map((d) => ({ key: d.label, name: d.label, value: Math.round(d.seconds / 60) }))} />
                  </ChartCard>
                </div>
              </>
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

        {(selectedUserId ?? currentUser?.id) && (
          <ScreenshotsPanel
            userId={selectedUserId ?? currentUser!.id}
            from={from}
            to={to}
            screenshotsEnabled={privacyQuery.data?.screenshotEnabled ?? false}
          />
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

        {isCompanyAdmin && (
          <>
            <PrivacySettingsAdmin />
            <ReportingLinesAdmin />
            <ApplicationsAdmin />
          </>
        )}
      </div>
    </>
  );
}

// Chronological thumbnail strip for one user's screenshots in the same
// from/to range the rest of the page uses, click-to-enlarge. Renders an
// honest empty state (screenshots off, or none yet) instead of ever
// showing a broken image icon -- `url` is only used once a row actually
// has one (a presigned URL that failed to resolve server-side is filtered
// out, not rendered broken).
function ScreenshotsPanel({ userId, from, to, screenshotsEnabled }: { userId: string; from: string; to: string; screenshotsEnabled: boolean }) {
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const screenshotsQuery = useQuery({
    queryKey: ['workforce', 'screenshots', userId, from, to],
    queryFn: () => getMyScreenshots(userId, { from, to }),
    enabled: screenshotsEnabled,
  });

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Screenshots</h2>

      {!screenshotsEnabled && (
        <div className="panel tick-frame p-6 text-center text-sm text-ink-500">Screenshots are not enabled for this company.</div>
      )}

      {screenshotsEnabled && screenshotsQuery.isLoading && <p className="text-sm text-ink-500">Loading screenshots…</p>}
      {screenshotsEnabled && screenshotsQuery.isError && <p className="field-error">{apiErrorMessage(screenshotsQuery.error)}</p>}

      {screenshotsEnabled && !screenshotsQuery.isLoading && (screenshotsQuery.data ?? []).filter((s) => s.url).length === 0 && (
        <div className="panel tick-frame p-6 text-center text-sm text-ink-500">No screenshots captured in this range yet.</div>
      )}

      {screenshotsEnabled && (screenshotsQuery.data ?? []).filter((s) => s.url).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(screenshotsQuery.data ?? []).filter((s) => s.url).map((s) => (
            <button
              key={s.id}
              onClick={() => setEnlarged(s.url)}
              className="w-28 h-20 overflow-hidden rounded border border-base-600 hover:border-signal shrink-0"
              title={new Date(s.capturedAt).toLocaleString()}
            >
              <img src={s.url!} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {enlarged && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 cursor-zoom-out"
          onClick={() => setEnlarged(null)}
        >
          <img src={enlarged} alt="Enlarged screenshot" className="max-w-[90vw] max-h-[90vh] rounded" />
        </div>
      )}
    </section>
  );
}

// Turns the privacy toggle from read-only into real -- the literal switch
// that turns screenshot capture (§2's server-side pipeline) on for the
// company. Off by default; each control fires its own update immediately
// on change, matching the existing dropdown-per-row pattern in
// ReportingLinesAdmin rather than a separate form + save button.
function PrivacySettingsAdmin() {
  const queryClient = useQueryClient();
  const privacyQuery = useQuery({ queryKey: ['workforce', 'privacy-settings'], queryFn: getWorkforcePrivacySettings });

  const updateMutation = useMutation({
    mutationFn: (dto: Parameters<typeof updateWorkforcePrivacySettings>[0]) => updateWorkforcePrivacySettings(dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workforce', 'privacy-settings'] }),
  });

  const settings = privacyQuery.data;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Privacy & monitoring settings (admin)</h2>
      {privacyQuery.isLoading && <p className="text-sm text-ink-500">Loading…</p>}
      {updateMutation.isError && <p className="field-error">{apiErrorMessage(updateMutation.error)}</p>}
      {settings && (
        <div className="panel tick-frame p-4 space-y-4 max-w-xl">
          <label className="block space-y-1">
            <div className="text-xs uppercase tracking-wide text-ink-500">Monitoring level</div>
            <select
              className="input"
              value={settings.monitoringLevel}
              disabled={updateMutation.isPending}
              onChange={(e) => updateMutation.mutate({ monitoringLevel: e.target.value as MonitoringLevel })}
            >
              {MONITORING_LEVELS.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </label>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.screenshotEnabled}
              disabled={updateMutation.isPending}
              onChange={(e) => updateMutation.mutate({ screenshotEnabled: e.target.checked })}
            />
            <span className="text-sm">
              Enable periodic screenshot capture
              <span className="block text-xs text-ink-500">
                Off by default. Confirm your company's employee-monitoring disclosure requirements before turning this on.
              </span>
            </span>
          </label>

          <label className="block space-y-1">
            <div className="text-xs uppercase tracking-wide text-ink-500">Retention (days)</div>
            <input
              type="number"
              className="input"
              min={1}
              max={3650}
              defaultValue={settings.retentionDays}
              disabled={updateMutation.isPending}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value !== settings.retentionDays) updateMutation.mutate({ retentionDays: value });
              }}
            />
          </label>
        </div>
      )}
    </section>
  );
}

// Minimal company-admin-only screen for setting who reports to whom --
// not an org-chart builder, just a table with one "manager" dropdown per
// row (per the brief's own scope: "this is not an HRIS"). Gated
// client-side on the current user's companyRole for display only; the
// actual enforcement is server-side (@Roles('company_admin') on
// ReportingLinesController).
function ReportingLinesAdmin() {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({ queryKey: ['users', 'all'], queryFn: listUsers });
  const linesQuery = useQuery({ queryKey: ['workforce', 'reporting-lines'], queryFn: listReportingLines });

  const setManagerMutation = useMutation({
    mutationFn: ({ userId, managerId }: { userId: string; managerId: string }) => setReportingLine(userId, managerId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workforce', 'reporting-lines'] }),
  });

  const managerByUserId = new Map((linesQuery.data ?? []).map((line) => [line.userId, line.managerId]));
  const users = usersQuery.data?.data ?? [];

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Reporting lines (admin)</h2>
      <p className="text-xs text-ink-500">
        Sets who a manager sees in their Workforce team view -- direct reports and, transitively, the people who report to them.
      </p>
      {(usersQuery.isLoading || linesQuery.isLoading) && <p className="text-sm text-ink-500">Loading company users…</p>}
      {setManagerMutation.isError && <p className="field-error">{apiErrorMessage(setManagerMutation.error)}</p>}
      {users.length > 0 && (
        <div className="panel tick-frame overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Manager</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-base-700/60 last:border-0">
                  <td className="px-4 py-2.5">{user.firstName} {user.lastName}</td>
                  <td className="px-4 py-2.5 text-ink-500">{user.companyRole}</td>
                  <td className="px-4 py-2.5">
                    <select
                      className="input !py-1 !text-xs"
                      value={managerByUserId.get(user.id) ?? ''}
                      disabled={setManagerMutation.isPending}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        setManagerMutation.mutate({ userId: user.id, managerId: e.target.value });
                      }}
                    >
                      <option value="">No manager set</option>
                      {users.filter((candidate) => candidate.id !== user.id).map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.firstName} {candidate.lastName}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const STAT_TILE_TONE_CLASS: Record<string, string> = {
  signal: 'text-signal',
  ok: 'text-ok',
  danger: 'text-danger',
  warn: 'text-warn',
};

function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'signal' | 'ok' | 'danger' | 'warn' }) {
  return (
    <div className="panel p-3 text-left">
      <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-0.5">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone ? STAT_TILE_TONE_CLASS[tone] : 'text-ink-100'}`}>{value}</div>
    </div>
  );
}

// DeskTime's own signature visual: a single stacked bar of
// productive/neutral/unproductive/unclassified time, in that order, so the
// productive share always reads left-to-right as "how much of this bar is
// green." Segments with 0 seconds render nothing rather than a sliver.
function ProductivityBar({ factors }: { factors: ProductivityFactors }) {
  const total =
    (factors.productiveSeconds ?? 0) + (factors.neutralSeconds ?? 0) + (factors.unproductiveSeconds ?? 0) + (factors.unclassifiedSeconds ?? 0);
  if (total <= 0) return null;
  const segments: { seconds: number; color: string }[] = [
    { seconds: factors.productiveSeconds ?? 0, color: HEX.ok },
    { seconds: factors.neutralSeconds ?? 0, color: HEX.ink500 },
    { seconds: factors.unproductiveSeconds ?? 0, color: HEX.danger },
    { seconds: factors.unclassifiedSeconds ?? 0, color: HEX.warn },
  ];
  return (
    <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-base-700">
      {segments
        .filter((s) => s.seconds > 0)
        .map((s, i) => (
          <div key={i} style={{ width: `${(s.seconds / total) * 100}%`, backgroundColor: s.color }} />
        ))}
    </div>
  );
}

// Company-admin-only screen for classifying each app the desktop agent has
// reported as Productive / Neutral / Unproductive -- DeskTime's own
// "Productivity Calculation" screen. New apps appear here already, as
// 'unclassified', the moment the agent first reports them (see
// ActivitiesService.ingest()'s auto-registration) -- an admin doesn't have
// to pre-populate the registry before it starts working.
function ApplicationsAdmin() {
  const queryClient = useQueryClient();
  const appsQuery = useQuery({ queryKey: ['workforce', 'applications'], queryFn: listApplications });

  const classifyMutation = useMutation({
    mutationFn: ({ id, classification }: { id: string; classification: ProductivityClassification }) =>
      updateApplicationClassification(id, classification),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workforce', 'applications'] }),
  });

  const apps = [...(appsQuery.data ?? [])].sort((a, b) => {
    if (a.productivityClassification === 'unclassified' && b.productivityClassification !== 'unclassified') return -1;
    if (b.productivityClassification === 'unclassified' && a.productivityClassification !== 'unclassified') return 1;
    return a.name.localeCompare(b.name);
  });
  const unclassifiedCount = apps.filter((a) => a.productivityClassification === 'unclassified').length;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-100 uppercase tracking-wide">Application productivity (admin)</h2>
      <p className="text-xs text-ink-500">
        Classify each app or executable the agent has reported as productive, neutral, or unproductive for your team's work — this
        drives the productivity breakdown above. {unclassifiedCount > 0 && `${unclassifiedCount} app(s) still need review.`}
      </p>
      {appsQuery.isLoading && <p className="text-sm text-ink-500">Loading applications…</p>}
      {classifyMutation.isError && <p className="field-error">{apiErrorMessage(classifyMutation.error)}</p>}
      {apps.length === 0 && !appsQuery.isLoading && (
        <div className="panel tick-frame p-6 text-center text-sm text-ink-500">
          No applications reported yet — they appear here automatically once a device is enrolled and reporting.
        </div>
      )}
      {apps.length > 0 && (
        <div className="panel tick-frame overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                <th className="px-4 py-2.5 font-medium">Application</th>
                <th className="px-4 py-2.5 font-medium">Match pattern</th>
                <th className="px-4 py-2.5 font-medium">Classification</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr key={app.id} className="border-b border-base-700/60 last:border-0">
                  <td className="px-4 py-2.5">{app.name}</td>
                  <td className="px-4 py-2.5 text-ink-500 font-mono text-xs">{app.matchPattern}</td>
                  <td className="px-4 py-2.5">
                    <select
                      className="input !py-1 !text-xs"
                      value={app.productivityClassification}
                      disabled={classifyMutation.isPending}
                      onChange={(e) => classifyMutation.mutate({ id: app.id, classification: e.target.value as ProductivityClassification })}
                    >
                      {PRODUCTIVITY_CLASSIFICATIONS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
