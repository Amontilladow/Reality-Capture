import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import type { GisPrepCounts, GisPrepJob, GisPrepJobStatus, GisPrepOutputFile, GisPrepProfile, GisPrepSettings } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { assertProfile } from './dto/gis-prep.dto';

export const GIS_PREP_MAX_SIZE_BYTES = 500 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['dxf', 'dwg']);

export interface GisPrepQueueJob {
  jobId: string;
  companyId: string;
  projectId: string;
}

// GIS Preparation (apps/adm-gis-prep as a built-in module). Same shape as
// SiteDrawingImportService: presigned upload, then a job row queued for the
// GisPrepProcessor -- the request never waits on the drawing run itself.
@Injectable()
export class GisPrepService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    @InjectQueue('gis-prep') private readonly queue: Queue<GisPrepQueueJob>,
  ) {}

  async getUploadUrl(companyId: string, projectId: string, filename: string) {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(`File type ".${ext}" is not supported. Allowed: DXF, DWG.`);
    }
    const key = this.storage.generateKey(companyId, projectId, 'gis-prep', filename);
    const url = await this.storage.getUploadUrl(key, 'application/octet-stream', GIS_PREP_MAX_SIZE_BYTES);
    return { ...url, storageKey: key };
  }

  async createJob(companyId: string, projectId: string, userId: string, input: { storageKey: string; originalFilename: string; settings: Record<string, unknown> }): Promise<GisPrepJob> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const profile = this.requireProfile(input.settings);
    // The key must be one this module issued for this company and project,
    // so a caller cannot point a job at another tenant's object.
    if (!input.storageKey.startsWith(`${companyId}/gis-prep/${projectId}/`)) {
      throw new BadRequestException('storageKey was not issued for this project.');
    }
    const sizeBytes = await this.storage.getObjectSize(input.storageKey);
    if (sizeBytes === null) {
      throw new BadRequestException('Uploaded file not found in storage. Complete the upload before creating the job.');
    }
    if (sizeBytes > GIS_PREP_MAX_SIZE_BYTES) {
      await this.storage.deleteIfExists(input.storageKey);
      throw new BadRequestException(`Uploaded file (${(sizeBytes / 1024 / 1024).toFixed(1)} MB) exceeds the ${GIS_PREP_MAX_SIZE_BYTES / 1024 / 1024} MB limit. The upload has been rejected and removed.`);
    }
    return this.insertAndQueue(companyId, projectId, userId, profile, input.originalFilename, input.storageKey, input.settings, null);
  }

  // A re-run with new decisions (layer mapping, accepted fixes, CRS) is a new
  // job on the same untouched original; the earlier job is kept.
  async rerunJob(companyId: string, projectId: string, userId: string, parentJobId: string, settings: Record<string, unknown>): Promise<GisPrepJob> {
    const profile = this.requireProfile(settings);
    const parent = await this.getRow(companyId, projectId, parentJobId);
    return this.insertAndQueue(companyId, projectId, userId, profile, parent.sourceFilename, parent.sourceStorageKey, settings, parent.id);
  }

  async listJobs(companyId: string, projectId: string): Promise<GisPrepJob[]> {
    const rows = await this.db.withTenant(companyId, sql => sql<GisPrepJobRow[]>`
      SELECT *, settings::text AS settings_text FROM gis_prep_jobs WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 50
    `);
    return rows.map(toJob);
  }

  async getJob(companyId: string, projectId: string, jobId: string): Promise<GisPrepJob> {
    const row = await this.getRow(companyId, projectId, jobId);
    const job = toJob(row);
    job.outputs = await Promise.all(job.outputs.map(async o => ({ ...o, url: await this.storage.getReadUrl(o.storageKey) })));
    if (row.packageStorageKey) job.packageUrl = await this.storage.getReadUrl(row.packageStorageKey);
    if (row.reportStorageKey) {
      job.report = JSON.parse((await this.storage.download(row.reportStorageKey)).toString('utf8')) as Record<string, unknown>;
    }
    return job;
  }

  private async insertAndQueue(
    companyId: string, projectId: string, userId: string, profile: GisPrepProfile, filename: string, storageKey: string,
    settings: Record<string, unknown>, parentJobId: string | null,
  ): Promise<GisPrepJob> {
    const [row] = await this.db.withTenant(companyId, sql => sql<GisPrepJobRow[]>`
      INSERT INTO gis_prep_jobs (company_id, project_id, profile, source_filename, source_storage_key, settings, parent_job_id, created_by)
      VALUES (${companyId}, ${projectId}, ${profile}, ${filename}, ${storageKey}, ${sql.json(settings as never)}, ${parentJobId}, ${userId})
      RETURNING *, settings::text AS settings_text
    `);
    await this.queue.add('run-gis-prep', { jobId: row.id, companyId, projectId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10000 },
    });
    return toJob(row);
  }

  private requireProfile(settings: Record<string, unknown>): GisPrepProfile {
    const profile = assertProfile(settings);
    if (!profile) throw new BadRequestException('settings.profile must be "sdd_planning" or "bdms_building".');
    return profile;
  }

  private async getRow(companyId: string, projectId: string, jobId: string): Promise<GisPrepJobRow> {
    const [row] = await this.db.withTenant(companyId, sql => sql<GisPrepJobRow[]>`
      SELECT *, settings::text AS settings_text FROM gis_prep_jobs WHERE id = ${jobId} AND project_id = ${projectId}
    `);
    if (!row) throw new NotFoundException(`GIS preparation job ${jobId} not found.`);
    return row;
  }

  private async assertProjectBelongsToCompany(companyId: string, projectId: string): Promise<void> {
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT id FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
    `);
    if (!project) throw new NotFoundException(`Project ${projectId} not found.`);
  }
}

export interface GisPrepJobRow {
  id: string; companyId: string; projectId: string; profile: GisPrepProfile; sourceFilename: string; sourceStorageKey: string;
  sourceSha256: string | null; status: GisPrepJobStatus; statusLabel: string | null; toolJobId: string | null;
  counts: GisPrepCounts | null; settings: GisPrepSettings; settingsText?: string; outputs: GisPrepOutputFile[] | null; reportStorageKey: string | null;
  packageStorageKey: string | null; errorMessage: string | null; parentJobId: string | null; createdBy: string;
  startedAt: string | null; finishedAt: string | null; createdAt: string;
}

// The client's postgres.camel transform also camelCases keys INSIDE json/jsonb values, so `settings` read back as
// a parsed column loses the engine's snake_case keys (zone_name -> zoneName) and the engine silently ignores them.
// Settings are therefore always read as text (settings::text AS settings_text) and parsed here, exactly as stored.
export function storedSettings<T>(r: { settings: T; settingsText?: string }): T {
  return r.settingsText !== undefined ? JSON.parse(r.settingsText) as T : r.settings;
}

export function toJob(r: GisPrepJobRow): GisPrepJob {
  return {
    id: r.id, companyId: r.companyId, projectId: r.projectId, profile: r.profile, sourceFilename: r.sourceFilename,
    sourceStorageKey: r.sourceStorageKey, sourceSha256: r.sourceSha256 ?? undefined, status: r.status,
    statusLabel: r.statusLabel ?? undefined, toolJobId: r.toolJobId ?? undefined, counts: r.counts ?? undefined,
    settings: storedSettings(r), outputs: r.outputs ?? [], packageStorageKey: r.packageStorageKey ?? undefined,
    errorMessage: r.errorMessage ?? undefined, parentJobId: r.parentJobId ?? undefined, createdBy: r.createdBy,
    startedAt: r.startedAt ?? undefined, finishedAt: r.finishedAt ?? undefined, createdAt: r.createdAt,
  };
}
