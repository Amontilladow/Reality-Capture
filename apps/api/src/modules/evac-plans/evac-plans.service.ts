import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import type {
  EvacPlanJob, EvacPlanJobStatus, EvacPlanOutputFile, EvacPlanProgress, EvacPlanReport, EvacPlanSettings, EvacPlanSourceFile,
} from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';

export const EVAC_PLAN_MAX_DRAWING_BYTES = 60 * 1024 * 1024;
export const EVAC_PLAN_MAX_LOGO_BYTES = 10 * 1024 * 1024;
export const EVAC_PLAN_MAX_FILES = 40;
const DRAWING_EXT = new Set(['pdf']);
const LOGO_EXT = new Set(['png', 'jpg', 'jpeg']);

export interface EvacPlanQueueJob {
  jobId: string;
  companyId: string;
  projectId: string;
}

// 3D Evacuation Plans. Same shape as GisPrepService: presigned uploads, then a
// job row queued for EvacPlanProcessor -- the request never waits on the
// conversion, which takes minutes per sheet.
@Injectable()
export class EvacPlansService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    @InjectQueue('evac-plans') private readonly queue: Queue<EvacPlanQueueJob>,
  ) {}

  async getUploadUrl(companyId: string, projectId: string, filename: string, kind: 'drawing' | 'logo') {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const allowed = kind === 'logo' ? LOGO_EXT : DRAWING_EXT;
    if (!allowed.has(ext)) {
      throw new BadRequestException(kind === 'logo'
        ? `Logo type ".${ext}" is not supported. Allowed: PNG, JPG.`
        : `File type ".${ext}" is not supported. Upload the evacuation plans as PDF.`);
    }
    const key = this.storage.generateKey(companyId, projectId, 'evac-plans', filename);
    const max = kind === 'logo' ? EVAC_PLAN_MAX_LOGO_BYTES : EVAC_PLAN_MAX_DRAWING_BYTES;
    const url = await this.storage.getUploadUrl(key, 'application/octet-stream', max);
    return { ...url, storageKey: key };
  }

  async createJob(
    companyId: string, projectId: string, userId: string,
    input: { files: { storageKey: string; filename: string }[]; logoStorageKey?: string; reuseLogoFromJobId?: string; settings?: EvacPlanSettings },
  ): Promise<EvacPlanJob> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    if (!input.files.length) throw new BadRequestException('Upload at least one evacuation-plan PDF.');
    if (input.files.length > EVAC_PLAN_MAX_FILES) {
      throw new BadRequestException(`At most ${EVAC_PLAN_MAX_FILES} drawings per conversion.`);
    }
    const sourceFiles: EvacPlanSourceFile[] = [];
    for (const f of input.files) {
      const sizeBytes = await this.checkUploaded(companyId, projectId, f.storageKey, EVAC_PLAN_MAX_DRAWING_BYTES);
      if (!f.storageKey.toLowerCase().endsWith('.pdf')) throw new BadRequestException(`${f.filename} is not a PDF.`);
      sourceFiles.push({ filename: f.filename, storageKey: f.storageKey, sizeBytes });
    }
    let logoKey: string | null = null;
    if (input.logoStorageKey) {
      await this.checkUploaded(companyId, projectId, input.logoStorageKey, EVAC_PLAN_MAX_LOGO_BYTES);
      logoKey = input.logoStorageKey;
    } else if (input.reuseLogoFromJobId) {
      logoKey = (await this.getRow(companyId, projectId, input.reuseLogoFromJobId)).logoStorageKey;
    }
    const settings = cleanSettings(input.settings);
    return this.insertAndQueue(companyId, projectId, userId, sourceFiles, logoKey, settings, null);
  }

  // A re-run converts the same untouched originals again (e.g. after an engine
  // update); the earlier job and its outputs are kept.
  async rerunJob(companyId: string, projectId: string, userId: string, parentJobId: string): Promise<EvacPlanJob> {
    const parent = await this.getRow(companyId, projectId, parentJobId);
    return this.insertAndQueue(companyId, projectId, userId, parent.sourceFiles, parent.logoStorageKey,
      storedSettings(parent), parent.id);
  }

  async listJobs(companyId: string, projectId: string): Promise<EvacPlanJob[]> {
    const rows = await this.db.withTenant(companyId, sql => sql<EvacPlanJobRow[]>`
      SELECT *, settings::text AS settings_text FROM evac_plan_jobs WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 50
    `);
    return rows.map(toJob);
  }

  async getJob(companyId: string, projectId: string, jobId: string): Promise<EvacPlanJob> {
    const row = await this.getRow(companyId, projectId, jobId);
    const job = toJob(row);
    job.outputs = await Promise.all(job.outputs.map(async o => ({ ...o, url: await this.storage.getReadUrl(o.storageKey) })));
    if (row.planPdfStorageKey) job.planPdfUrl = await this.storage.getReadUrl(row.planPdfStorageKey);
    if (row.packageStorageKey) job.packageUrl = await this.storage.getReadUrl(row.packageStorageKey);
    if (row.reportStorageKey) {
      job.report = JSON.parse((await this.storage.download(row.reportStorageKey)).toString('utf8')) as EvacPlanReport;
    }
    return job;
  }

  private async checkUploaded(companyId: string, projectId: string, storageKey: string, maxBytes: number): Promise<number> {
    // The key must be one this module issued for this company and project,
    // so a caller cannot point a job at another tenant's object.
    if (!storageKey.startsWith(`${companyId}/evac-plans/${projectId}/`)) {
      throw new BadRequestException('storageKey was not issued for this project.');
    }
    const sizeBytes = await this.storage.getObjectSize(storageKey);
    if (sizeBytes === null) {
      throw new BadRequestException('Uploaded file not found in storage. Complete the upload before converting.');
    }
    if (sizeBytes > maxBytes) {
      await this.storage.deleteIfExists(storageKey);
      throw new BadRequestException(`Uploaded file (${(sizeBytes / 1024 / 1024).toFixed(1)} MB) exceeds the ${maxBytes / 1024 / 1024} MB limit. The upload has been rejected and removed.`);
    }
    return sizeBytes;
  }

  private async insertAndQueue(
    companyId: string, projectId: string, userId: string, files: EvacPlanSourceFile[], logoKey: string | null,
    settings: EvacPlanSettings, parentJobId: string | null,
  ): Promise<EvacPlanJob> {
    const [row] = await this.db.withTenant(companyId, (sql) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filesJson = sql.json(files as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settingsJson = sql.json(settings as any);
      return sql<EvacPlanJobRow[]>`
        INSERT INTO evac_plan_jobs (company_id, project_id, source_files, logo_storage_key, settings, parent_job_id, created_by)
        VALUES (${companyId}, ${projectId}, ${filesJson}, ${logoKey}, ${settingsJson}, ${parentJobId}, ${userId})
        RETURNING *, settings::text AS settings_text
      `;
    });
    await this.queue.add('run-evac-plans', { jobId: row.id, companyId, projectId }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 30000 },
    });
    return toJob(row);
  }

  private async getRow(companyId: string, projectId: string, jobId: string): Promise<EvacPlanJobRow> {
    const [row] = await this.db.withTenant(companyId, sql => sql<EvacPlanJobRow[]>`
      SELECT *, settings::text AS settings_text FROM evac_plan_jobs WHERE id = ${jobId} AND project_id = ${projectId}
    `);
    if (!row) throw new NotFoundException(`Evacuation-plan conversion ${jobId} not found.`);
    return row;
  }

  private async assertProjectBelongsToCompany(companyId: string, projectId: string): Promise<void> {
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT id FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
    `);
    if (!project) throw new NotFoundException(`Project ${projectId} not found.`);
  }
}

export function cleanSettings(s: EvacPlanSettings | undefined): EvacPlanSettings {
  const out: EvacPlanSettings = {};
  if (typeof s?.revision === 'string' && s.revision.trim()) out.revision = s.revision.trim().slice(0, 60);
  if (Array.isArray(s?.notes)) {
    const notes = s!.notes.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map(n => n.trim().slice(0, 500));
    if (notes.length) out.notes = notes.slice(0, 30);
  }
  return out;
}

export interface EvacPlanJobRow {
  id: string; companyId: string; projectId: string; sourceFiles: EvacPlanSourceFile[]; logoStorageKey: string | null;
  settings: EvacPlanSettings; settingsText?: string; status: EvacPlanJobStatus; statusLabel: string | null;
  progress: EvacPlanProgress | null; serviceJobId: string | null; outputs: EvacPlanOutputFile[] | null;
  reportStorageKey: string | null; planPdfStorageKey: string | null; packageStorageKey: string | null;
  errorMessage: string | null; parentJobId: string | null; createdBy: string; startedAt: string | null;
  finishedAt: string | null; createdAt: string;
}

// postgres.camel also camelCases keys inside jsonb values; settings are read as
// text and parsed so they reach the engine exactly as stored (see GisPrepService).
export function storedSettings(r: { settings: EvacPlanSettings; settingsText?: string }): EvacPlanSettings {
  return r.settingsText !== undefined ? JSON.parse(r.settingsText) as EvacPlanSettings : r.settings;
}

export function toJob(r: EvacPlanJobRow): EvacPlanJob {
  return {
    id: r.id, companyId: r.companyId, projectId: r.projectId, sourceFiles: r.sourceFiles ?? [],
    logoStorageKey: r.logoStorageKey ?? undefined, settings: storedSettings(r), status: r.status,
    statusLabel: r.statusLabel ?? undefined, progress: r.progress ?? undefined, outputs: r.outputs ?? [],
    errorMessage: r.errorMessage ?? undefined, createdBy: r.createdBy, startedAt: r.startedAt ?? undefined,
    finishedAt: r.finishedAt ?? undefined, createdAt: r.createdAt,
  };
}
