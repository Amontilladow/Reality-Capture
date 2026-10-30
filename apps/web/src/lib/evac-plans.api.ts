import axios from 'axios';
import { apiGet, apiPost } from './api';
import type { EvacPlanJob, EvacPlanJobStatus, EvacPlanOutputFile, EvacPlanProgress, EvacPlanSettings } from '@engineeringos/types';
export type {
  EvacPlanJob, EvacPlanJobStatus, EvacPlanOutputFile, EvacPlanProgress, EvacPlanReport, EvacPlanSettings, EvacPlanSheetReport,
} from '@engineeringos/types';

const base = (projectId: string) => `/projects/${projectId}/evac-plans`;

export const listEvacPlanJobs = (projectId: string) => apiGet<EvacPlanJob[]>(`${base(projectId)}/jobs`);

export const getEvacPlanJob = (projectId: string, jobId: string) => apiGet<EvacPlanJob>(`${base(projectId)}/jobs/${jobId}`);

export const rerunEvacPlanJob = (projectId: string, jobId: string) => apiPost<EvacPlanJob>(`${base(projectId)}/jobs/${jobId}/rerun`, {});

async function upload(projectId: string, file: File, kind: 'drawing' | 'logo'): Promise<string> {
  const { uploadUrl, storageKey } = await apiPost<{ uploadUrl: string; storageKey: string }>(
    `${base(projectId)}/upload-url`, { filename: file.name, kind });
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': 'application/octet-stream' } });
  return storageKey;
}

// Same flow as every other upload in this app: presigned URL, PUT each file
// straight to storage, then create the job record. onProgress reports files done.
export async function uploadAndConvert(
  projectId: string,
  input: { drawings: File[]; logo?: File | null; reuseLogoFromJobId?: string; settings: EvacPlanSettings },
  onProgress?: (done: number, total: number) => void,
): Promise<EvacPlanJob> {
  const total = input.drawings.length + (input.logo ? 1 : 0);
  const files: { storageKey: string; filename: string }[] = [];
  for (const f of input.drawings) {
    files.push({ storageKey: await upload(projectId, f, 'drawing'), filename: f.name });
    onProgress?.(files.length, total);
  }
  const logoStorageKey = input.logo ? await upload(projectId, input.logo, 'logo') : undefined;
  return apiPost<EvacPlanJob>(`${base(projectId)}/jobs`, {
    files, logoStorageKey, reuseLogoFromJobId: logoStorageKey ? undefined : input.reuseLogoFromJobId, settings: input.settings,
  });
}

// --- presentation helpers (pure, unit-tested) -------------------------------

export function progressPercent(p: EvacPlanProgress | undefined): number {
  if (!p?.total) return 0;
  return Math.max(0, Math.min(100, Math.round(((p.done ?? 0) / p.total) * 100)));
}

const STAGE: Record<string, string> = {
  starting: 'Starting', identifying: 'Reading sheet titles', building: 'Reconstructing floors',
  'choosing views': 'Choosing views', rendering: 'Rendering 3D', assembling: 'Assembling the package', done: 'Finishing',
};

export function stageLabel(p: EvacPlanProgress | undefined): string {
  if (!p?.stage) return 'Waiting for the converter';
  return (STAGE[p.stage] ?? p.stage) + (p.current ? ` · ${p.current}` : '');
}

const SYMBOL: Record<string, string> = {
  fire_extinguisher: 'extinguishers', wheeled_extinguisher: 'wheeled extinguishers', fire_hose_reel: 'hose reels',
  manual_call_point: 'call points', lift: 'lifts', exit_sign: 'exits', assembly_point: 'assembly points',
  fire_brigade_inlet: 'brigade inlets',
};

export function symbolSummary(symbols: Record<string, number>): string {
  return Object.entries(symbols).map(([k, n]) => `${n} ${SYMBOL[k] ?? k.replace(/_/g, ' ')}`).join(' · ');
}

// Files for one sheet code, e.g. sheets/GF-01.pdf, previews/GF-01.png, models/GF-01.glb.
export function sheetFiles(outputs: EvacPlanOutputFile[], code: string) {
  const find = (path: string) => outputs.find(o => o.path === path);
  return {
    preview: find(`previews/${code}.png`), pdf: find(`sheets/${code}.pdf`), svg: find(`sheets/${code}.svg`),
    model: find(`models/${code}.glb`),
  };
}

export const ACTIVE_STATUSES: EvacPlanJobStatus[] = ['QUEUED', 'RUNNING'];
