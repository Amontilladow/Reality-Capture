import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { StatusBadge } from '../components/ui/Badge';
import type { StatusTone } from '../lib/status-tone';
import { apiErrorMessage } from '../lib/api';
import { getProject } from '../lib/projects.api';
import {
  getGisPrepJob, listGisPrepJobs, rerunGisPrepJob, uploadAndCreateGisPrepJob,
  type GisPrepJob, type GisPrepJobStatus, type GisPrepProfile, type GisPrepSettings,
} from '../lib/gis-prep.api';

// GIS Preparation (apps/adm-gis-prep as a built-in module). Every result is a
// PRELIMINARY check: nothing on this page may say a drawing is ADM/DRM
// compliant, approved, or passed QC -- only the official QC tool and review
// decide that.
const PROVISIONAL = 'PROVISIONAL: NOT ADM-VALIDATED';

const STATUS_TONE: Record<GisPrepJobStatus, StatusTone> = {
  QUEUED: 'neutral', RUNNING: 'progress', READY_FOR_REVIEW: 'info', PREPARED_WITH_WARNINGS: 'warning', BLOCKED: 'danger', FAILED: 'critical',
};
const STATUS_LABEL: Record<GisPrepJobStatus, string> = {
  QUEUED: 'Queued', RUNNING: 'Running', READY_FOR_REVIEW: 'Ready for review', PREPARED_WITH_WARNINGS: 'Prepared with warnings',
  BLOCKED: 'Blocked', FAILED: 'Failed',
};
const ACTIVE: GisPrepJobStatus[] = ['QUEUED', 'RUNNING'];

const CRS_OPTIONS = [
  { value: '', label: 'Unknown (do not guess)' },
  { value: 'EPSG:32640', label: 'WGS 84 / UTM zone 40N (EPSG:32640)' },
  { value: 'EPSG:32639', label: 'WGS 84 / UTM zone 39N (EPSG:32639)' },
];

interface FormState {
  profile: GisPrepProfile;
  strict: boolean;
  sourceCrs: string;
  crsConfirmed: boolean;
  unitsConfirmed: boolean;
  categories: string[];
  meta: Record<string, string>;
  controlPoints: string;
}

const INITIAL: FormState = {
  profile: 'bdms_building', strict: true, sourceCrs: '', crsConfirmed: false, unitsConfirmed: false,
  categories: ['plot'], meta: {}, controlPoints: '',
};

const BDMS_FIELDS = [
  ['zone_name', 'Zone name', 'KHALIFA CITY'], ['sector_number', 'Sector', 'SE45_01'], ['plot_number', 'Plot', 'C8'],
  ['building_number', 'Building', '1'], ['floor_id', 'Floor', 'G, F1, M1, B1'], ['contractor_name', 'Contractor', 'M4 Contracting'],
] as const;
const SDD_FIELDS = [
  ['project_id', 'CDP Project ID', 'P101'], ['submission_date', 'Date (YYYYMMDD)', '20261026'], ['drawing_type', 'AP / MP', 'AP'],
  ['spec_type', 'ADM / DOT', 'ADM'], ['consultant_name', 'Consultant', ''], ['contractor_name', 'Contractor', 'M4 Contracting'],
] as const;

// "x,y E,N" per line (local drawing coordinates -> UTM), as in the desktop tool.
function parseControlPoints(text: string): [[number, number], [number, number]][] {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map((line) => {
    const n = line.split(/[\s,;]+/).map(Number);
    if (n.length !== 4 || n.some(Number.isNaN)) throw new Error(`Control point line "${line}" must have 4 numbers: x y E N`);
    return [[n[0], n[1]], [n[2], n[3]]];
  });
}

function buildSettings(f: FormState): GisPrepSettings {
  const controlPoints = parseControlPoints(f.controlPoints);
  return {
    profile: f.profile,
    strict: f.strict,
    categories: f.profile === 'bdms_building' ? ['building'] : f.categories,
    metadata: f.meta,
    crs: {
      source_crs: f.sourceCrs || null, source_confirmed: f.crsConfirmed,
      ...(controlPoints.length ? { control_points: controlPoints, confirm_transformation: f.crsConfirmed } : {}),
    },
    units_confirmed_metres: f.unitsConfirmed,
  };
}

export default function GisPrepPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const projectQuery = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId!), enabled: Boolean(projectId) });
  const jobsQuery = useQuery({
    queryKey: ['gis-prep-jobs', projectId],
    queryFn: () => listGisPrepJobs(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: (q) => ((q.state.data ?? []).some(j => ACTIVE.includes(j.status)) ? 4000 : false),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Choose a DXF or DWG drawing first.');
      return uploadAndCreateGisPrepJob(projectId!, file, buildSettings(form));
    },
    onSuccess: (job) => {
      setFormError(null);
      setSelectedId(job.id);
      queryClient.invalidateQueries({ queryKey: ['gis-prep-jobs', projectId] });
    },
    onError: (err) => setFormError(err instanceof Error && !('isAxiosError' in err) ? err.message : apiErrorMessage(err)),
  });

  if (!projectId) return null;
  const fields = form.profile === 'bdms_building' ? BDMS_FIELDS : SDD_FIELDS;
  const jobs = jobsQuery.data ?? [];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: projectQuery.data?.name ?? 'Loading…', to: `/projects/${projectId}` }, { label: 'GIS Preparation' }]}
        title="GIS Preparation"
        subtitle="Prepare DXF/DWG drawings for ADM / DRM GIS submission and run preliminary checks."
      />
      <div className="p-6 space-y-4">
        <div className="panel p-3 border border-warn/40 bg-warn/5 text-xs text-ink-100">
          {PROVISIONAL}. These are preliminary checks only. Acceptance is decided by the official ADM/DRM QC tool and review.
          The original drawing is stored unchanged; every change and open decision is listed in the job report.
        </div>

        <div className="panel tick-frame p-4 space-y-3">
          <div className="text-sm font-medium text-ink-100">New job</div>
          <div className="flex flex-wrap gap-4 text-xs text-ink-300">
            {(['bdms_building', 'sdd_planning'] as const).map(p => (
              <label key={p} className="flex items-center gap-1.5">
                <input type="radio" checked={form.profile === p} onChange={() => setForm(f => ({ ...f, profile: p, meta: {} }))} />
                {p === 'bdms_building' ? 'DRM BDMS 4.1 building floor' : 'ADM SDD planning v1.18.2'}
              </label>
            ))}
          </div>
          <input type="file" accept=".dxf,.dwg" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-xs text-ink-300" />
          {form.profile === 'sdd_planning' && (
            <div className="flex flex-wrap gap-4 text-xs text-ink-300">
              {['plot', 'roads', 'services'].map(c => (
                <label key={c} className="flex items-center gap-1.5">
                  <input
                    type="checkbox" checked={form.categories.includes(c)}
                    onChange={e => setForm(f => ({ ...f, categories: e.target.checked ? [...f.categories, c] : f.categories.filter(x => x !== c) }))}
                  />
                  {c[0].toUpperCase() + c.slice(1)}
                </label>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {fields.map(([key, label, placeholder]) => (
              <label key={key} className="text-xs text-ink-500 space-y-1">
                <span>{label}</span>
                <input
                  className="field-input text-xs !py-1.5" placeholder={placeholder} value={form.meta[key] ?? ''}
                  onChange={e => setForm(f => ({ ...f, meta: { ...f.meta, [key]: e.target.value } }))}
                />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-xs text-ink-500 space-y-1">
              <span>Source coordinate system</span>
              <select className="field-input text-xs !py-1.5" value={form.sourceCrs} onChange={e => setForm(f => ({ ...f, sourceCrs: e.target.value }))}>
                {CRS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-ink-500 space-y-1">
              <span>Control points (optional, one per line: x y E N)</span>
              <textarea
                className="field-input text-xs !py-1.5 font-mono" rows={2} value={form.controlPoints}
                onChange={e => setForm(f => ({ ...f, controlPoints: e.target.value }))}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-ink-300">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.crsConfirmed} onChange={e => setForm(f => ({ ...f, crsConfirmed: e.target.checked }))} />
              I confirm the coordinate system{form.controlPoints.trim() ? ' and the control-point transformation' : ''}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.unitsConfirmed} onChange={e => setForm(f => ({ ...f, unitsConfirmed: e.target.checked }))} />
              Units confirmed (metres)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.strict} onChange={e => setForm(f => ({ ...f, strict: e.target.checked }))} />
              Strict mode (any warning or open decision blocks)
            </label>
          </div>
          {formError && <p className="text-xs text-danger">{formError}</p>}
          <button className="btn-primary" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Uploading…' : 'Prepare for GIS'}
          </button>
        </div>

        {jobsQuery.isError && <div className="panel p-4 text-sm text-danger">{apiErrorMessage(jobsQuery.error)}</div>}

        <div className="panel tick-frame overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                <th className="px-3 py-2.5 font-medium">Drawing</th>
                <th className="px-3 py-2.5 font-medium">Profile</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Errors / warnings / decisions</th>
                <th className="px-3 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.id} onClick={() => setSelectedId(j.id)} className={`border-b border-base-700/60 last:border-0 cursor-pointer hover:bg-base-800/60 ${selectedId === j.id ? 'bg-base-800/60' : ''}`}>
                  <td className="px-3 py-2.5 text-ink-100">{j.sourceFilename}{j.parentJobId && <span className="text-xs text-ink-500"> · re-run</span>}</td>
                  <td className="px-3 py-2.5 text-ink-300 whitespace-nowrap">{j.profile}</td>
                  <td className="px-3 py-2.5"><StatusBadge tone={STATUS_TONE[j.status]} label={STATUS_LABEL[j.status]} dot /></td>
                  <td className="px-3 py-2.5 text-ink-300 whitespace-nowrap">{j.counts ? `${j.counts.errors} / ${j.counts.warnings} / ${j.counts.openDecisions}` : '—'}</td>
                  <td className="px-3 py-2.5 text-ink-500 whitespace-nowrap">{new Date(j.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {!jobsQuery.isLoading && jobs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-500">No GIS preparation jobs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedId && <JobDetail projectId={projectId} jobId={selectedId} onRerun={setSelectedId} />}
      </div>
    </>
  );
}

interface ReportFinding { rule_id: string; severity: string; message: string; action: string; handle?: string | null; layer?: string | null; blocking?: boolean }
interface ReportDecision { source_layer: string; entity_count: number; suggestions: string[] }
interface QcSummaryRow { qc_error: string; count: number; layers: string[] }

function JobDetail({ projectId, jobId, onRerun }: { projectId: string; jobId: string; onRerun: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const jobQuery = useQuery({
    queryKey: ['gis-prep-job', projectId, jobId],
    queryFn: () => getGisPrepJob(projectId, jobId),
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.status) ? 4000 : false),
  });
  const rerun = useMutation({
    mutationFn: (job: GisPrepJob) => {
      const chosen = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v.trim()));
      return rerunGisPrepJob(projectId, job.id, { ...job.settings, layer_mapping: { ...(job.settings.layer_mapping ?? {}), ...chosen } });
    },
    onSuccess: (job) => {
      setMapping({});
      queryClient.invalidateQueries({ queryKey: ['gis-prep-jobs', projectId] });
      onRerun(job.id);
    },
  });

  if (jobQuery.isLoading) return <div className="panel p-6 text-sm text-ink-500">Loading job…</div>;
  if (jobQuery.isError || !jobQuery.data) return <div className="panel p-6 text-sm text-danger">{apiErrorMessage(jobQuery.error)}</div>;
  const job = jobQuery.data;
  const report = job.report as undefined | {
    findings?: ReportFinding[]; qc_style_summary?: QcSummaryRow[]; review_queue?: { unresolved_layers?: ReportDecision[] };
  };
  const findings = (report?.findings ?? []).filter(f => f.severity !== 'INFO');
  const unresolved = report?.review_queue?.unresolved_layers ?? [];
  const downloads = job.outputs.filter(o => o.path.startsWith('output/') || o.path === 'qc_report.html');

  return (
    <div className="panel tick-frame p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink-100">{job.sourceFilename}</span>
        <StatusBadge tone={STATUS_TONE[job.status]} label={STATUS_LABEL[job.status]} dot />
        <span className="text-xs text-ink-500">{PROVISIONAL} · Official QC: not yet performed</span>
      </div>
      {job.statusLabel && <p className="text-xs text-ink-300">Tool status: {job.statusLabel}</p>}
      {job.errorMessage && <p className="text-xs text-danger">{job.errorMessage}</p>}

      {downloads.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {job.packageUrl && <a className="btn-secondary !px-3 !py-1.5 text-xs" href={job.packageUrl}>Download full package (.zip)</a>}
          {downloads.map(o => <a key={o.path} className="btn-ghost !px-3 !py-1.5 text-xs" href={o.url} target="_blank" rel="noreferrer">{o.path.replace(/^output\//, '')}</a>)}
        </div>
      )}

      {(report?.qc_style_summary ?? []).length > 0 && (
        <div>
          <div className="text-xs font-medium text-ink-300 mb-1">Summary in official QC terms</div>
          <table className="w-full text-xs">
            <tbody>
              {report!.qc_style_summary!.map(r => (
                <tr key={r.qc_error} className="border-b border-base-700/60 last:border-0">
                  <td className="py-1.5 pr-3 text-ink-100">{r.qc_error}</td>
                  <td className="py-1.5 pr-3 text-ink-300">{r.count}</td>
                  <td className="py-1.5 text-ink-500">{r.layers.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unresolved.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-ink-300">Layer mapping decisions ({unresolved.length} unresolved). The tool never decides these for you.</div>
          {unresolved.map(d => (
            <div key={d.source_layer} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-ink-100 w-56 truncate" title={d.source_layer}>{d.source_layer}</span>
              <span className="text-ink-500">{d.entity_count} entities →</span>
              <input
                className="field-input w-48 text-xs !py-1" list={`sugg-${d.source_layer}`} placeholder="ADM layer or __exclude__"
                value={mapping[d.source_layer] ?? ''} onChange={e => setMapping(m => ({ ...m, [d.source_layer]: e.target.value }))}
              />
              <datalist id={`sugg-${d.source_layer}`}>
                {[...d.suggestions, '__exclude__'].map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
          ))}
        </div>
      )}
      {!ACTIVE.includes(job.status) && (
        <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={rerun.isPending} onClick={() => rerun.mutate(job)}>
          {rerun.isPending ? 'Queuing…' : 'Re-run with these decisions'}
        </button>
      )}
      {rerun.isError && <p className="text-xs text-danger">{apiErrorMessage(rerun.error)}</p>}

      {findings.length > 0 && (
        <div>
          <div className="text-xs font-medium text-ink-300 mb-1">Findings ({findings.length}, blocking first)</div>
          <ul className="space-y-1 max-h-96 overflow-y-auto text-xs">
            {findings.slice(0, 300).map((f, i) => (
              <li key={i} className="border-b border-base-700/60 pb-1">
                <span className={f.severity === 'ERROR' ? 'text-danger' : 'text-warn'}>{f.severity}</span>{' '}
                <span className="font-mono text-ink-500">{f.rule_id}</span>{' '}
                {f.layer && <span className="text-ink-500">{f.layer} </span>}
                {f.handle && <span className="font-mono text-ink-500">#{f.handle} </span>}
                <span className="text-ink-100">{f.message}</span>
                <span className="text-ink-500"> · Next: {f.action}</span>
              </li>
            ))}
          </ul>
          {findings.length > 300 && <p className="text-xs text-ink-500 mt-1">Showing 300 of {findings.length}; the full list is in qc_report.html.</p>}
        </div>
      )}
    </div>
  );
}
