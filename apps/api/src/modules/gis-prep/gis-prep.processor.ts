import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import JSZip from 'jszip';
import type { GisPrepCounts, GisPrepJobStatus, GisPrepOutputFile } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import type { GisPrepQueueJob } from './gis-prep.service';

// A full drawing run (reading, checks, writing one DXF per dataset/floor)
// can take minutes on large drawings.
const SERVICE_TIMEOUT_MS = 15 * 60 * 1000;

const CONTENT_TYPES: Record<string, string> = {
  dxf: 'application/dxf', json: 'application/json', jsonl: 'application/x-ndjson',
  html: 'text/html; charset=utf-8', txt: 'text/plain; charset=utf-8', zip: 'application/zip', svg: 'image/svg+xml',
};

interface JobDbRow {
  id: string;
  sourceFilename: string;
  sourceStorageKey: string;
  settings: Record<string, unknown>;
}

// The service rejected the request itself (bad settings, unreadable file):
// retrying the same input cannot succeed, so the job fails without a retry.
class NonRetryableError extends Error {}

// Runs the apps/adm-gis-prep service on one uploaded drawing and stores the
// complete job package (prepared DXFs, QC report, manifests, audit log) under
// <company>/gis-prep/<project>/<job>/. The original upload is never changed.
@Processor('gis-prep')
export class GisPrepProcessor {
  private readonly logger = new Logger(GisPrepProcessor.name);
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('app.gisPrepServiceUrl') ?? 'http://localhost:8002';
    this.secret = config.get<string>('app.internalServiceSecret') ?? '';
  }

  @Process('run-gis-prep')
  async handle(job: Job<GisPrepQueueJob>): Promise<void> {
    const { jobId, companyId, projectId } = job.data;
    try {
      const [row] = await this.db.withTenant(companyId, sql => sql<JobDbRow[]>`
        UPDATE gis_prep_jobs SET status = 'RUNNING', started_at = now(), error_message = NULL
        WHERE id = ${jobId} RETURNING id, source_filename, source_storage_key, settings
      `);
      if (!row) throw new NonRetryableError(`GIS preparation job ${jobId} no longer exists.`);

      const drawing = await this.storage.download(row.sourceStorageKey);
      const { zip, toolStatus, toolJobId, kind } = await this.callService(row, drawing);
      const files = await JSZip.loadAsync(zip);

      const prefix = `${companyId}/gis-prep/${projectId}/${jobId}`;
      const outputs: GisPrepOutputFile[] = [];
      let report: Record<string, unknown> | null = null;
      // A preparation job reports in qc_report.json; a conversion job in conversion_report.json (its draft's
      // preliminary QC is nested under validation/).
      const reportName = kind === 'conversion' ? 'conversion_report.json' : 'qc_report.json';
      for (const entry of Object.values(files.files)) {
        if (entry.dir || !isSafeEntryName(entry.name)) continue;
        const body = await entry.async('nodebuffer');
        const storageKey = `${prefix}/${entry.name}`;
        await this.storage.upload(storageKey, body, contentType(entry.name));
        outputs.push({ path: entry.name, storageKey, sizeBytes: body.length });
        if (entry.name === reportName) report = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
      }
      if (!report) throw new NonRetryableError(`The GIS preparation service returned no ${reportName}.`);
      const packageKey = `${prefix}/package.zip`;
      await this.storage.upload(packageKey, zip, CONTENT_TYPES.zip);

      const source = (report.source ?? {}) as { sha256_before?: string; sha256?: string };
      await this.db.withTenant(companyId, (sql) => {
        // sql.json()'s JSONValue type needs an index signature a plain
        // interface can't structurally satisfy (same boundary as
        // SharePointIntegrationService).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const countsJson = sql.json(countsFromReport(report!) as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outputsJson = sql.json(outputs as any);
        return sql`
          UPDATE gis_prep_jobs SET
            status = ${statusFromLabel(toolStatus)}, status_label = ${toolStatus}, tool_job_id = ${toolJobId},
            source_sha256 = ${source.sha256_before ?? source.sha256 ?? null}, counts = ${countsJson}, outputs = ${outputsJson},
            report_storage_key = ${`${prefix}/${reportName}`}, package_storage_key = ${packageKey}, finished_at = now()
          WHERE id = ${jobId}
        `;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`GIS preparation job ${jobId} failed: ${message}`);
      await this.db.withTenant(companyId, sql => sql`
        UPDATE gis_prep_jobs SET status = 'FAILED', error_message = ${message.slice(0, 2000)}, finished_at = now() WHERE id = ${jobId}
      `);
      // Bull's own retry/backoff takes over for transient failures (service
      // restarting, storage blip); a rejected input is final.
      if (!(err instanceof NonRetryableError)) throw err;
    }
  }

  private async callService(row: JobDbRow, drawing: Buffer) {
    const form = new FormData();
    form.append('settings', JSON.stringify(row.settings));
    form.append('drawing', new Blob([drawing]), row.sourceFilename);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/prepare`, {
        method: 'POST',
        headers: { 'X-Internal-Service-Secret': this.secret },
        body: form,
        signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
      });
    } catch (err) {
      // Network-level failure (service not deployed, restarting, timed out):
      // still retried by Bull, but recorded in words an engineer can act on
      // instead of undici's bare "fetch failed".
      const cause = err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
      throw new Error(`The GIS preparation service could not be reached (${cause}). Check that the service at GIS_PREP_SERVICE_URL (engineeringos-ai-service) is running, then re-run the job.`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const message = `GIS preparation service returned ${res.status}: ${readableDetail(detail)}`;
      if (res.status === 422 || res.status === 413) throw new NonRetryableError(message);
      throw new Error(message);
    }
    return {
      zip: Buffer.from(await res.arrayBuffer()),
      toolStatus: res.headers.get('x-m4adm-status') ?? '',
      toolJobId: res.headers.get('x-m4adm-job'),
      kind: res.headers.get('x-m4adm-kind') ?? 'preparation',
    };
  }
}

export function statusFromLabel(label: string): GisPrepJobStatus {
  if (label === 'Ready for review') return 'READY_FOR_REVIEW';
  if (label === 'Prepared with warnings') return 'PREPARED_WITH_WARNINGS';
  // Conversion drafts (m4adm.convert): a draft with no open review items is ready for the engineer's review;
  // every other draft still needs review or georeferencing. Never "approved".
  if (label === 'Draft generated - no open review items; official QC not yet performed') return 'READY_FOR_REVIEW';
  if (label.startsWith('Draft generated - BLOCKED')) return 'BLOCKED';    // identifiers missing: never guessed
  if (label.startsWith('Draft generated')) return 'PREPARED_WITH_WARNINGS';
  // Anything else ("Blocked by errors", the strict-mode block, or a label
  // this version does not know) is treated as blocked, never as ready.
  return 'BLOCKED';
}

export function countsFromReport(report: Record<string, unknown>): GisPrepCounts {
  if (report.kind === 'conversion') {
    // Errors/warnings of the preliminary QC run on the generated draft; decisions = features needing review.
    const v = ((report.validation as { counts?: Record<string, number> } | null)?.counts) ?? {};
    const feats = (report.features as { status?: string }[] | undefined) ?? [];
    const open = feats.filter(f => f.status === 'GENERATED_REQUIRES_REVIEW' || f.status === 'UNRESOLVED').length;
    return { errors: v.ERROR ?? 0, warnings: v.WARNING ?? 0, info: v.INFO ?? 0, openDecisions: open };
  }
  const c = ((report.status as { counts?: Record<string, number> } | undefined)?.counts) ?? {};
  return {
    errors: c.ERROR ?? 0, warnings: c.WARNING ?? 0, info: c.INFO ?? 0,
    openDecisions: (c.unresolved_layers ?? 0) + (c.open_fix_proposals ?? 0),
  };
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
