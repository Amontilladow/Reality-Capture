import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { StatusBadge } from '../components/ui/Badge';
import type { StatusTone } from '../lib/status-tone';
import { apiErrorMessage } from '../lib/api';
import { getProject } from '../lib/projects.api';
import { loadSavedForm, saveForm } from '../lib/saved-form';
import {
  getGisPrepJob, listGisPrepJobs, rerunGisPrepJob, uploadAndCreateGisPrepJob,
  type GisConvertSettings, type GisPrepJob, type GisPrepJobStatus, type GisPrepProfile, type GisPrepSettings,
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
  // convert = build a DRM BDMS draft from an architectural floor plan; prepare = check an existing GIS drawing.
  mode: 'convert' | 'prepare';
  unitNumber: string;
  // Building / floor / title facts a floor plan cannot show (conversion). Empty stays empty and is reported.
  facts: Record<string, string>;
  units: 'auto' | 'mm' | 'cm' | 'm';
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
  mode: 'convert', unitNumber: '', units: 'auto', facts: {},
  profile: 'bdms_building', strict: true, sourceCrs: '', crsConfirmed: false, unitsConfirmed: false,
  categories: ['plot'], meta: {}, controlPoints: '',
};

// What was typed is kept per project in this browser. Confirmations (coordinate system / transformation, units)
// are never restored: they must be given each time.
const formKey = (projectId: string) => `gis-prep-form:${projectId}`;
const NEVER_RESTORE: Partial<FormState> = { crsConfirmed: false, unitsConfirmed: false };

// Values the drawing cannot provide; sent as conversion settings. Code-listed values (usage, drawing type) are
// checked against the BDMS code lists by the validator, so a typo shows up in the report rather than here.
const FACT_FIELDS = [
  ['floor_height', 'Floor height (m)', '3.6'], ['building_number_of_floors', 'Number of floors', '2'],
  ['building_height', 'Building height (m)', '15'],
  ['building_usage_category', 'Usage category (code list)', 'Commercial'],
  ['building_usage_type', 'Usage type (code list)', 'Single-use Commercial'],
] as const;
const TITLE_FIELDS = [
  ['DeveloperName', 'Developer name', 'MASDAR CITY'], ['BuildingName', 'Building name', ''],
  ['DrawingType', 'Drawing type', 'As Built'], ['DateOfDrawing', 'Date of drawing', '14-JAN-2026'],
] as const;

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

function buildSettings(f: FormState): GisPrepSettings | GisConvertSettings {
  const controlPoints = parseControlPoints(f.controlPoints);
  if (f.mode === 'convert') {
    return {
      mode: 'convert', profile: 'bdms_building', metadata: f.meta, source_units: f.units,
      single_unit_number: f.unitNumber,
      floor_height: f.facts.floor_height ?? '',
      building_number_of_floors: f.facts.building_number_of_floors ?? '',
      building_height: f.facts.building_height ?? '',
      building_usage_category: f.facts.building_usage_category ?? '',
      building_usage_type: f.facts.building_usage_type ?? '',
      title_values: Object.fromEntries(TITLE_FIELDS.map(([k]) => [k, f.facts[k] ?? '']).filter(([, v]) => v)),
      crs: { control_points: controlPoints, confirm_transformation: f.crsConfirmed },
    };
  }
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
  const [form, setForm] = useState<FormState>(() => (projectId ? loadSavedForm(formKey(projectId), INITIAL, NEVER_RESTORE) : INITIAL));
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { if (projectId) saveForm(formKey(projectId), form); }, [projectId, form]);

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
  const fields = form.mode === 'convert' || form.profile === 'bdms_building' ? BDMS_FIELDS : SDD_FIELDS;
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
            {([['convert', 'Convert architectural floor plan → DRM BDMS draft'], ['prepare', 'Check an existing GIS drawing']] as const).map(([m, label]) => (
              <label key={m} className="flex items-center gap-1.5 font-medium">
                <input type="radio" checked={form.mode === m} onChange={() => setForm(f => ({ ...f, mode: m, profile: m === 'convert' ? 'bdms_building' : f.profile }))} />
                {label}
              </label>
            ))}
          </div>
          {form.mode === 'convert' && (
            <p className="text-xs text-ink-500">
              Detects rooms from wall linework, names them from room text, writes Space/Door/Window/Floor features with
              their Detail blocks, and validates the generated draft. Anything the drawing cannot show (units, owners,
              plot, roof, heights) stays empty and is listed; nothing is guessed.
            </p>
          )}
          {form.mode === 'prepare' && <div className="flex flex-wrap gap-4 text-xs text-ink-300">
            {(['bdms_building', 'sdd_planning'] as const).map(p => (
              <label key={p} className="flex items-center gap-1.5">
                <input type="radio" checked={form.profile === p} onChange={() => setForm(f => ({ ...f, profile: p, meta: {} }))} />
                {p === 'bdms_building' ? 'DRM BDMS 4.1 building floor' : 'ADM SDD planning v1.18.2'}
              </label>
            ))}
          </div>}
          <input type="file" accept=".dxf,.dwg" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-xs text-ink-300" />
          {form.mode === 'prepare' && form.profile === 'sdd_planning' && (
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
          {form.mode === 'convert' && (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              {[...FACT_FIELDS, ...TITLE_FIELDS].map(([key, label, placeholder]) => (
                <label key={key} className="text-xs text-ink-500 space-y-1">
                  <span>{label}</span>
                  <input
                    className="field-input text-xs !py-1.5" placeholder={placeholder} value={form.facts[key] ?? ''}
                    onChange={e => setForm(f => ({ ...f, facts: { ...f.facts, [key]: e.target.value } }))}
                  />
                </label>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {form.mode === 'prepare' && <label className="text-xs text-ink-500 space-y-1">
              <span>Source coordinate system</span>
              <select className="field-input text-xs !py-1.5" value={form.sourceCrs} onChange={e => setForm(f => ({ ...f, sourceCrs: e.target.value }))}>
                {CRS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>}
            {form.mode === 'convert' && (
              <label className="text-xs text-ink-500 space-y-1">
                <span>Drawing units</span>
                <select className="field-input text-xs !py-1.5" value={form.units} onChange={e => setForm(f => ({ ...f, units: e.target.value as FormState['units'] }))}>
                  <option value="auto">From the drawing ($INSUNITS)</option>
                  <option value="mm">Millimetres</option><option value="cm">Centimetres</option><option value="m">Metres</option>
                </select>
              </label>
            )}
            {form.mode === 'convert' && (
              <label className="text-xs text-ink-500 space-y-1">
                <span>Unit number (whole floor is one unit) — required for the QC links</span>
                <input className="field-input text-xs !py-1.5" value={form.unitNumber} onChange={e => setForm(f => ({ ...f, unitNumber: e.target.value }))} />
              </label>
            )}
            <label className="text-xs text-ink-500 space-y-1">
              <span>Control points (optional, one per line: x y E N; x y in drawing units)</span>
              <textarea
                className="field-input text-xs !py-1.5 font-mono" rows={2} value={form.controlPoints}
                onChange={e => setForm(f => ({ ...f, controlPoints: e.target.value }))}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-ink-300">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.crsConfirmed} onChange={e => setForm(f => ({ ...f, crsConfirmed: e.target.checked }))} />
              {form.mode === 'convert' ? 'I confirm the control-point transformation' : <>I confirm the coordinate system{form.controlPoints.trim() ? ' and the control-point transformation' : ''}</>}
            </label>
            {form.mode === 'prepare' && <>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={form.unitsConfirmed} onChange={e => setForm(f => ({ ...f, unitsConfirmed: e.target.checked }))} />
                Units confirmed (metres)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={form.strict} onChange={e => setForm(f => ({ ...f, strict: e.target.checked }))} />
                Strict mode (any warning or open decision blocks)
              </label>
            </>}
          </div>
          {formError && <p className="text-xs text-danger">{formError}</p>}
          <button className="btn-primary" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Uploading…' : form.mode === 'convert' ? 'Convert to GIS draft' : 'Prepare for GIS'}
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
                <tr key={j.id} onClick={() => setSelectedId(j.id)} className={`border-b border-base-700/60 last:border-0 cursor-pointer hover:bg-base-700 ${selectedId === j.id ? 'bg-base-800/60' : ''}`}>
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
      const settings = job.settings as GisPrepSettings;
      return rerunGisPrepJob(projectId, job.id, { ...settings, layer_mapping: { ...(settings.layer_mapping ?? {}), ...chosen } });
    },
    onSuccess: (job) => {
      setMapping({});
      queryClient.invalidateQueries({ queryKey: ['gis-prep-jobs', projectId] });
      onRerun(job.id);
    },
  });

  if (jobQuery.data?.report && (jobQuery.data.report as { kind?: string }).kind === 'conversion') {
    return <ConversionDetail projectId={projectId} job={jobQuery.data} onRerun={onRerun} />;
  }
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

interface ConvFeature {
  id: string; layer: string; status: string; reasons: string[];
  attributes: Record<string, { value: string; provenance: string; note: string }>;
}
interface ConversionReport {
  kind: 'conversion'; status: string; blockers: string[]; identifiers_missing?: string[];
  result: Record<string, string | number>;
  features: ConvFeature[]; missing_mandatory: { feature: string; tag: string; note: string }[];
  georeferencing: { status: string; messages: string[] };
}

const FEATURE_TONE: Record<string, StatusTone> = {
  AUTO_GENERATED_HIGH_CONFIDENCE: 'success', GENERATED_REQUIRES_REVIEW: 'warning', UNRESOLVED: 'danger',
  NOT_GENERATED: 'neutral', USER_ACCEPTED: 'info', USER_REJECTED: 'neutral',
};

// Conversion result: what was generated, what needs review, what is missing. Review decisions (accept / reject)
// are sent back as feature_decisions on a re-run of the same untouched original.
function ConversionDetail({ projectId, job, onRerun }: { projectId: string; job: GisPrepJob; onRerun: (id: string) => void }) {
  const queryClient = useQueryClient();
  const report = job.report as unknown as ConversionReport;
  const [decisions, setDecisions] = useState<Record<string, 'accept' | 'reject'>>({});
  const rerun = useMutation({
    mutationFn: () => {
      const settings = job.settings as GisConvertSettings;
      const merged = { ...(settings.feature_decisions ?? {}) };
      for (const [id, action] of Object.entries(decisions)) merged[id] = { action };
      return rerunGisPrepJob(projectId, job.id, { ...settings, feature_decisions: merged });
    },
    onSuccess: (j) => { setDecisions({}); queryClient.invalidateQueries({ queryKey: ['gis-prep-jobs', projectId] }); onRerun(j.id); },
  });
  const review = report.features.filter(f => f.status === 'GENERATED_REQUIRES_REVIEW' || f.status === 'UNRESOLVED');
  const preview = job.outputs.find(o => o.path === 'preview.svg');
  const downloads = job.outputs.filter(o => o.path.startsWith('output/') || o.path === 'conversion_report.html');
  return (
    <div className="panel tick-frame p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink-100">{job.sourceFilename}</span>
        <StatusBadge tone={STATUS_TONE[job.status]} label={STATUS_LABEL[job.status]} dot />
        <span className="text-xs text-ink-500">{PROVISIONAL} · DRAFT for engineer review · Official QC: not yet performed</span>
      </div>
      <p className="text-xs text-ink-300">{report.status}</p>
      {report.blockers.map(b => <p key={b} className="text-xs text-danger">{b}</p>)}
      {(report.identifiers_missing ?? []).length > 0 && (
        <p className="text-xs text-danger">Blocked until provided (never guessed): {report.identifiers_missing!.join(', ')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {job.packageUrl && <a className="btn-secondary !px-3 !py-1.5 text-xs" href={job.packageUrl}>Download full package (.zip)</a>}
        {downloads.map(o => <a key={o.path} className="btn-ghost !px-3 !py-1.5 text-xs" href={o.url} target="_blank" rel="noreferrer">{o.path.replace(/^output\//, '')}</a>)}
      </div>
      <table className="text-xs">
        <tbody>
          {Object.entries(report.result).map(([k, v]) => (
            <tr key={k} className="border-b border-base-700/60 last:border-0"><td className="py-1 pr-4 text-ink-500 whitespace-pre">{k}</td><td className="py-1 text-ink-100">{String(v)}</td></tr>
          ))}
        </tbody>
      </table>
      {preview?.url && <img src={preview.url} alt="Generated features preview" className="w-full bg-white rounded" />}
      <div className="text-xs text-ink-300">Georeferencing: {report.georeferencing.status} — {report.georeferencing.messages.join(' ')}</div>
      {review.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-ink-300">Items requiring review ({review.length})</div>
          {review.map(f => (
            <div key={f.id} className="flex flex-wrap items-start gap-2 text-xs border-b border-base-700/60 pb-1">
              <StatusBadge tone={FEATURE_TONE[f.status] ?? 'neutral'} label={f.status === 'UNRESOLVED' ? 'Unresolved' : 'Review'} />
              <span className="font-mono text-ink-100">{f.id}</span>
              <span className="text-ink-500">{f.layer}{f.attributes.SPACEUSAGE?.value ? ` · ${f.attributes.SPACEUSAGE.value}` : ''}</span>
              <span className="text-ink-300 flex-1 min-w-[16rem]">{f.reasons.join(' · ')}</span>
              {f.status === 'GENERATED_REQUIRES_REVIEW' && (
                <span className="flex gap-2">
                  {(['accept', 'reject'] as const).map(a => (
                    <label key={a} className="flex items-center gap-1">
                      <input type="radio" name={`dec-${f.id}`} checked={decisions[f.id] === a} onChange={() => setDecisions(d => ({ ...d, [f.id]: a }))} />{a}
                    </label>
                  ))}
                </span>
              )}
            </div>
          ))}
          <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={rerun.isPending || Object.keys(decisions).length === 0} onClick={() => rerun.mutate()}>
            {rerun.isPending ? 'Queuing…' : 'Re-run with these decisions'}
          </button>
          {rerun.isError && <p className="text-xs text-danger">{apiErrorMessage(rerun.error)}</p>}
        </div>
      )}
      {report.missing_mandatory.length > 0 && (
        <div className="text-xs">
          <div className="font-medium text-ink-300 mb-1">Mandatory values the drawing cannot provide ({report.missing_mandatory.length})</div>
          <ul className="list-disc pl-5 text-ink-500 max-h-48 overflow-y-auto">
            {report.missing_mandatory.map((m, i) => <li key={i}>{m.feature}: {m.tag}{m.note ? ` — ${m.note}` : ''}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
