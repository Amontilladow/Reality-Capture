import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { StatusBadge } from '../components/ui/Badge';
import type { StatusTone } from '../lib/status-tone';
import { apiErrorMessage } from '../lib/api';
import { getProject } from '../lib/projects.api';
import {
  ACTIVE_STATUSES, getEvacPlanJob, listEvacPlanJobs, progressPercent, rerunEvacPlanJob, sheetFiles, stageLabel,
  symbolSummary, uploadAndConvert, type EvacPlanJob, type EvacPlanJobStatus,
} from '../lib/evac-plans.api';

// 3D Evacuation Plans (apps/evac3d-service). Every result is a DRAFT for the
// appointed Fire & Life Safety consultant: nothing on this page may say a plan
// is compliant or approved by Civil Defence.
const DRAFT = 'DRAFT for Fire & Life Safety consultant review. No code compliance or Civil Defence approval is claimed.';

const STATUS_TONE: Record<EvacPlanJobStatus, StatusTone> = {
  QUEUED: 'neutral', RUNNING: 'progress', READY_FOR_REVIEW: 'info', NEEDS_ATTENTION: 'warning', FAILED: 'critical',
};
const STATUS_LABEL: Record<EvacPlanJobStatus, string> = {
  QUEUED: 'Queued', RUNNING: 'Converting', READY_FOR_REVIEW: 'Ready for review', NEEDS_ATTENTION: 'Needs attention', FAILED: 'Failed',
};

const fmtMb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

export default function EvacPlansPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [drawings, setDrawings] = useState<File[]>([]);
  const [logo, setLogo] = useState<File | null>(null);
  const [reuseLogo, setReuseLogo] = useState(true);
  const [revision, setRevision] = useState('P01 (draft)');
  const [notes, setNotes] = useState('');
  const [uploaded, setUploaded] = useState<[number, number] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const projectQuery = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId!), enabled: Boolean(projectId) });
  const jobsQuery = useQuery({
    queryKey: ['evac-plan-jobs', projectId],
    queryFn: () => listEvacPlanJobs(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: (q) => ((q.state.data ?? []).some(j => ACTIVE_STATUSES.includes(j.status)) ? 5000 : false),
  });
  const jobs = jobsQuery.data ?? [];
  const lastLogoJob = jobs.find(j => j.logoStorageKey);

  const convert = useMutation({
    mutationFn: () => {
      if (!drawings.length) throw new Error('Choose the 2D evacuation-plan PDFs first.');
      return uploadAndConvert(projectId!, {
        drawings, logo,
        reuseLogoFromJobId: !logo && reuseLogo ? lastLogoJob?.id : undefined,
        settings: { revision: revision.trim() || undefined, notes: notes.split('\n').map(n => n.trim()).filter(Boolean) },
      }, (done, total) => setUploaded([done, total]));
    },
    onSuccess: (job) => {
      setFormError(null);
      setUploaded(null);
      setDrawings([]);
      setLogo(null);
      setSelectedId(job.id);
      queryClient.invalidateQueries({ queryKey: ['evac-plan-jobs', projectId] });
    },
    onError: (err) => {
      setUploaded(null);
      setFormError(err instanceof Error && !('isAxiosError' in err) ? err.message : apiErrorMessage(err));
    },
  });

  if (!projectId) return null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: projectQuery.data?.name ?? 'Loading…', to: `/projects/${projectId}` }, { label: '3D Evacuation Plans' }]}
        title="3D Evacuation Plans"
        subtitle="Convert 2D evacuation-plan PDFs into 3D evacuation-plan sheets in the approved format."
      />
      <div className="p-6 space-y-4">
        <div className="panel p-4 border border-warn/40 bg-warn/5 text-xs text-ink-100">
          {DRAFT} Routes, exits and equipment are taken from the uploaded sheets as drawn; the escape strategy is never
          redesigned. Check every sheet against its comparison page before use.
        </div>

        <div className="panel tick-frame p-4 space-y-4">
          <div className="text-sm font-medium text-ink-100">New conversion</div>
          <p className="text-xs text-ink-500">
            Upload one PDF per evacuation-plan sheet (every floor and every "You are here" version). Floors are read from
            each sheet's title. AutoCAD-plotted PDFs with their layers kept work best.
          </p>
          <label className="block text-xs text-ink-500 space-y-2">
            <span>Evacuation-plan PDFs</span>
            <input
              type="file" accept=".pdf,application/pdf" multiple aria-label="Evacuation-plan PDFs"
              onChange={e => setDrawings(Array.from(e.target.files ?? []))} className="block text-xs text-ink-300"
            />
          </label>
          {drawings.length > 0 && (
            <ul className="text-xs text-ink-300 space-y-2 max-h-40 overflow-y-auto">
              {drawings.map(f => <li key={f.name}>{f.name} <span className="text-ink-500">· {fmtMb(f.size)}</span></li>)}
            </ul>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-xs text-ink-500 space-y-2">
              <span>Logo (PNG or JPG, optional)</span>
              <input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" aria-label="Logo"
                onChange={e => setLogo(e.target.files?.[0] ?? null)} className="block text-xs text-ink-300" />
              {!logo && lastLogoJob && (
                <span className="flex items-center gap-2 text-ink-300">
                  <input type="checkbox" checked={reuseLogo} onChange={e => setReuseLogo(e.target.checked)} />
                  Use the logo from the previous conversion
                </span>
              )}
            </label>
            <label className="text-xs text-ink-500 space-y-2">
              <span>Revision shown on each sheet</span>
              <input className="field-input text-xs !py-2" value={revision} onChange={e => setRevision(e.target.value)} />
            </label>
          </div>
          <label className="block text-xs text-ink-500 space-y-2">
            <span>Review notes for the QC report (optional, one per line)</span>
            <textarea className="field-input text-xs !py-2 w-full" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Mezzanine: areas crossed with diagonal lines are voids" />
          </label>
          {formError && <p className="text-xs text-danger">{formError}</p>}
          <button className="btn-primary" disabled={convert.isPending} onClick={() => convert.mutate()}>
            {convert.isPending ? (uploaded ? `Uploading ${uploaded[0]} of ${uploaded[1]}…` : 'Uploading…') : 'Convert to 3D'}
          </button>
        </div>

        {jobsQuery.isError && <div className="panel p-4 text-sm text-danger">{apiErrorMessage(jobsQuery.error)}</div>}

        <div className="panel tick-frame overflow-x-auto" tabIndex={0}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                <th className="px-4 py-2 font-medium">Drawings</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Progress</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.id} onClick={() => setSelectedId(j.id)} className={`border-b border-base-700/60 last:border-0 cursor-pointer hover:bg-base-700 ${selectedId === j.id ? 'bg-base-800/60' : ''}`}>
                  <td className="px-4 py-2 text-ink-100">
                    {j.sourceFiles.length} sheet{j.sourceFiles.length === 1 ? '' : 's'}
                    <span className="text-xs text-ink-500"> · {j.sourceFiles.slice(0, 2).map(f => f.filename).join(', ')}{j.sourceFiles.length > 2 ? '…' : ''}</span>
                  </td>
                  <td className="px-4 py-2"><StatusBadge tone={STATUS_TONE[j.status]} label={STATUS_LABEL[j.status]} dot /></td>
                  <td className="px-4 py-2 text-ink-300 whitespace-nowrap">
                    {ACTIVE_STATUSES.includes(j.status) ? `${progressPercent(j.progress)}% · ${stageLabel(j.progress)}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-ink-500 whitespace-nowrap">{new Date(j.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {!jobsQuery.isLoading && jobs.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-ink-500">No conversions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedId && <JobDetail projectId={projectId} jobId={selectedId} onRerun={setSelectedId} />}
      </div>
    </>
  );
}

function JobDetail({ projectId, jobId, onRerun }: { projectId: string; jobId: string; onRerun: (id: string) => void }) {
  const queryClient = useQueryClient();
  const jobQuery = useQuery({
    queryKey: ['evac-plan-job', projectId, jobId],
    queryFn: () => getEvacPlanJob(projectId, jobId),
    refetchInterval: (q) => (q.state.data && ACTIVE_STATUSES.includes(q.state.data.status) ? 5000 : false),
  });
  const rerun = useMutation({
    mutationFn: (job: EvacPlanJob) => rerunEvacPlanJob(projectId, job.id),
    onSuccess: (j) => { queryClient.invalidateQueries({ queryKey: ['evac-plan-jobs', projectId] }); onRerun(j.id); },
  });

  if (jobQuery.isLoading) return <div className="panel p-6 text-sm text-ink-500">Loading conversion…</div>;
  if (jobQuery.isError || !jobQuery.data) return <div className="panel p-6 text-sm text-danger">{apiErrorMessage(jobQuery.error)}</div>;
  const job = jobQuery.data;
  const report = job.report;
  const active = ACTIVE_STATUSES.includes(job.status);
  const sheetsProgress = job.progress?.sheets ?? [];

  return (
    <div className="panel tick-frame p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink-100">{job.sourceFiles.length} sheet{job.sourceFiles.length === 1 ? '' : 's'}</span>
        <StatusBadge tone={STATUS_TONE[job.status]} label={STATUS_LABEL[job.status]} dot />
        <span className="text-xs text-ink-500">DRAFT · FLS consultant review required</span>
      </div>
      {job.statusLabel && <p className="text-xs text-ink-300">{job.statusLabel}</p>}
      {job.errorMessage && <p className="text-xs text-danger">{job.errorMessage}</p>}

      {active && (
        <div className="space-y-2">
          <div className="text-xs text-ink-300">{stageLabel(job.progress)} · {progressPercent(job.progress)}%</div>
          <div className="h-2 rounded bg-base-700 overflow-hidden" role="progressbar" aria-valuenow={progressPercent(job.progress)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-blueprint transition-all" style={{ width: `${progressPercent(job.progress)}%` }} />
          </div>
          {sheetsProgress.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {sheetsProgress.map(s => (
                <span key={s.code} className={`px-2 py-2 rounded border ${s.status === 'failed' ? 'border-danger text-danger' : s.status === 'done' ? 'border-base-500 text-ink-100' : 'border-base-600 text-ink-500'}`}>
                  {s.code} · {s.status}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-ink-500">Conversion takes a few minutes per sheet. You can leave this page; the job keeps running.</p>
        </div>
      )}

      {(job.planPdfUrl || job.packageUrl) && (
        <div className="flex flex-wrap gap-2">
          {job.planPdfUrl && <a className="btn-primary !px-4 !py-2 text-xs" href={job.planPdfUrl} target="_blank" rel="noreferrer">Open combined PDF</a>}
          {job.packageUrl && <a className="btn-secondary !px-4 !py-2 text-xs" href={job.packageUrl}>Download everything (.zip)</a>}
        </div>
      )}

      {report && report.failedSheets.length > 0 && (
        <div className="text-xs text-danger space-y-2">
          {report.failedSheets.map(f => <p key={f.code}>{f.code} ({f.file}): {f.error}</p>)}
        </div>
      )}

      {report && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {report.sheets.map(s => {
            const f = sheetFiles(job.outputs, s.code);
            return (
              <div key={s.code} className="border border-base-600 rounded p-2 space-y-2">
                {f.preview?.url && (
                  <a href={f.pdf?.url ?? f.preview.url} target="_blank" rel="noreferrer">
                    <img src={f.preview.url} alt={`${s.code} ${s.floorName} preview`} className="w-full rounded bg-white" loading="lazy" />
                  </a>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink-100">{s.code}</span>
                  <span className="text-xs text-ink-500">{s.floorName}</span>
                  <StatusBadge tone={s.flags.length ? 'warning' : 'success'} label={s.flags.length ? `${s.flags.length} to check` : 'No automatic flags'} />
                </div>
                <p className="text-xs text-ink-500">{symbolSummary(s.symbols)}</p>
                <p className="text-xs text-ink-500">
                  {s.routeSegments} route segments · {s.stairs} escape stairs · arrows {s.arrowsAgree}/{s.arrowsTotal} · YOU ARE HERE {s.youAreHere ? 'found' : 'not found'}
                </p>
                {s.flags.length > 0 && (
                  <ul className="list-disc pl-4 text-xs text-warn space-y-2">{s.flags.map(fl => <li key={fl}>{fl}</li>)}</ul>
                )}
                <div className="flex flex-wrap gap-2 text-xs">
                  {f.pdf?.url && <a className="btn-ghost !px-2 !py-2" href={f.pdf.url} target="_blank" rel="noreferrer">PDF</a>}
                  {f.svg?.url && <a className="btn-ghost !px-2 !py-2" href={f.svg.url} target="_blank" rel="noreferrer">SVG</a>}
                  {f.model?.url && <a className="btn-ghost !px-2 !py-2" href={f.model.url}>3D model (.glb)</a>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!active && (
        <button className="btn-secondary !px-4 !py-2 text-xs" disabled={rerun.isPending} onClick={() => rerun.mutate(job)}>
          {rerun.isPending ? 'Queuing…' : 'Convert the same drawings again'}
        </button>
      )}
      {rerun.isError && <p className="text-xs text-danger">{apiErrorMessage(rerun.error)}</p>}
    </div>
  );
}
