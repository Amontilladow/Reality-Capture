import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import JSZip from 'jszip';
import type { EvacPlanJobStatus, EvacPlanOutputFile, EvacPlanProgress, EvacPlanReport, EvacPlanSourceFile } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { storedSettings, type EvacPlanQueueJob } from './evac-plans.service';

// A batch converts at a few minutes per sheet; 40 sheets on a busy service
// still finishes well inside this.
const JOB_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', svg: 'image/svg+xml', json: 'application/json',
  glb: 'model/gltf-binary', zip: 'application/zip',
};

interface JobDbRow {
  id: string;
  sourceFiles: EvacPlanSourceFile[];
  logoStorageKey: string | null;
  settings: Record<string, unknown>;
  settingsText?: string;
}

interface ServiceState {
  status: 'queued' | 'running' | 'done' | 'failed';
  rejected?: boolean;
  error?: string;
  progress?: EvacPlanProgress;
}

// The service rejected the input itself (no readable evacuation plan, bad
// file): resubmitting the same files cannot succeed.
class NonRetryableError extends Error {}

// Runs apps/evac3d-service on one batch of uploaded PDFs and stores the
// complete package (combined PDF, per-sheet PDF/SVG/preview/glTF, report.json)
// under <company>/evac-plans/<project>/<job>/. The uploads are never changed.
@Processor('evac-plans')
export class EvacPlansProcessor {
  private readonly logger = new Logger(EvacPlansProcessor.name);
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly pollMs: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('app.evacPlanServiceUrl') ?? 'http://localhost:8003';
    this.secret = config.get<string>('app.internalServiceSecret') ?? '';
    this.pollMs = config.get<number>('app.evacPlanPollMs') ?? 10000;
  }

  @Process('run-evac-plans')
  async handle(job: Job<EvacPlanQueueJob>): Promise<void> {
    const { jobId, companyId, projectId } = job.data;
    let serviceJobId: string | null = null;
    try {
      const [row] = await this.db.withTenant(companyId, sql => sql<JobDbRow[]>`
        UPDATE evac_plan_jobs SET status = 'RUNNING', started_at = now(), error_message = NULL, progress = NULL
        WHERE id = ${jobId} RETURNING id, source_files, logo_storage_key, settings, settings::text AS settings_text
      `);
      if (!row) throw new NonRetryableError(`Evacuation-plan conversion ${jobId} no longer exists.`);

      serviceJobId = await this.submit(row);
      await this.db.withTenant(companyId, sql => sql`UPDATE evac_plan_jobs SET service_job_id = ${serviceJobId} WHERE id = ${jobId}`);
      await this.waitForService(serviceJobId, companyId, jobId);

      const zip = await this.call(`/jobs/${serviceJobId}/result`, { method: 'GET' });
      const files = await JSZip.loadAsync(zip);
      const prefix = `${companyId}/evac-plans/${projectId}/${jobId}`;
      const outputs: EvacPlanOutputFile[] = [];
      let report: EvacPlanReport | null = null;
      for (const entry of Object.values(files.files)) {
        if (entry.dir || !isSafeEntryName(entry.name)) continue;
        const body = await entry.async('nodebuffer');
        const storageKey = `${prefix}/${entry.name}`;
        await this.storage.upload(storageKey, body, contentType(entry.name));
        outputs.push({ path: entry.name, storageKey, sizeBytes: body.length });
        if (entry.name === 'report.json') report = JSON.parse(body.toString('utf8')) as EvacPlanReport;
      }
      if (!report) throw new NonRetryableError('The conversion service returned no report.json.');
      const packageKey = `${prefix}/package.zip`;
      await this.storage.upload(packageKey, zip, CONTENT_TYPES.zip);

      await this.db.withTenant(companyId, (sql) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outputsJson = sql.json(outputs as any);
        return sql`
          UPDATE evac_plan_jobs SET
            status = ${statusFromReport(report!)}, status_label = ${report!.statusLabel ?? null}, outputs = ${outputsJson},
            report_storage_key = ${`${prefix}/report.json`}, plan_pdf_storage_key = ${`${prefix}/evacuation_plans.pdf`},
            package_storage_key = ${packageKey}, finished_at = now()
          WHERE id = ${jobId}
        `;
      });
      await this.call(`/jobs/${serviceJobId}`, { method: 'DELETE' }).catch(() => undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Evacuation-plan conversion ${jobId} failed: ${message}`);
      await this.db.withTenant(companyId, sql => sql`
        UPDATE evac_plan_jobs SET status = 'FAILED', error_message = ${message.slice(0, 2000)}, finished_at = now() WHERE id = ${jobId}
      `);
      if (serviceJobId) await this.call(`/jobs/${serviceJobId}`, { method: 'DELETE' }).catch(() => undefined);
      // Bull's retry takes over for transient failures (service restarting,
      // storage blip); a rejected input is final.
      if (!(err instanceof NonRetryableError)) throw err;
    }
  }

  private async submit(row: JobDbRow): Promise<string> {
    const form = new FormData();
    for (const f of row.sourceFiles) {
      form.append('drawings', new Blob([await this.storage.download(f.storageKey)]), f.filename);
    }
    if (row.logoStorageKey) {
      const ext = row.logoStorageKey.split('.').pop()?.toLowerCase() ?? 'png';
      form.append('logo', new Blob([await this.storage.download(row.logoStorageKey)]), `logo.${ext}`);
    }
    form.append('settings', JSON.stringify(storedSettings(row as never)));
    const body = await this.call('/jobs', { method: 'POST', body: form });
    return (JSON.parse(body.toString('utf8')) as { id: string }).id;
  }

  private async waitForService(serviceJobId: string, companyId: string, jobId: string): Promise<void> {
    const started = Date.now();
    let lastProgress = '';
    for (;;) {
      const state = JSON.parse((await this.call(`/jobs/${serviceJobId}`, { method: 'GET' })).toString('utf8')) as ServiceState;
      const progress = JSON.stringify(state.progress ?? {});
      if (progress !== lastProgress) {
        lastProgress = progress;
        await this.db.withTenant(companyId, (sql) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = sql.json((state.progress ?? {}) as any);
          return sql`UPDATE evac_plan_jobs SET progress = ${p} WHERE id = ${jobId}`;
        });
      }
      if (state.status === 'done') return;
      if (state.status === 'failed') {
        const message = `Conversion failed: ${state.error ?? 'no message'}`;
        throw state.rejected ? new NonRetryableError(message) : new Error(message);
      }
      if (Date.now() - started > JOB_TIMEOUT_MS) throw new Error('The conversion did not finish in time.');
      await sleep(this.pollMs);
    }
  }

  private async call(path: string, init: { method: string; body?: FormData }): Promise<Buffer> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'X-Internal-Service-Secret': this.secret },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const cause = err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
      throw new Error(`The 3D evacuation-plan service could not be reached (${cause}). Check that the service at EVAC3D_SERVICE_URL (engineeringos-evac3d-service) is running, then re-run the conversion.`);
    }
    if (!res.ok) {
      const detail = readableDetail(await res.text().catch(() => ''));
      const message = `3D evacuation-plan service returned ${res.status}: ${detail}`;
      if (res.status === 422 || res.status === 413) throw new NonRetryableError(message);
      // 404 while polling: the service restarted and lost the job; the queue retry resubmits it.
      throw new Error(message);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

export function statusFromReport(report: Pick<EvacPlanReport, 'status'>): EvacPlanJobStatus {
  // Anything other than the explicit clean status needs a person to look first.
  return report.status === 'READY_FOR_REVIEW' ? 'READY_FOR_REVIEW' : 'NEEDS_ATTENTION';
}

// Zip entries become storage key suffixes, so no absolute paths or "..".
export function isSafeEntryName(name: string): boolean {
  return !name.startsWith('/') && !name.includes('\\') && !name.split('/').some(p => p === '..' || p === '');
}

function contentType(name: string): string {
  return CONTENT_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

function readableDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail.slice(0, 1000);
    return JSON.stringify(parsed.detail ?? parsed).slice(0, 1000);
  } catch {
    return body.slice(0, 1000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
