import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { SiteDrawingSourceProvider, SiteDrawingWorkflowStatus } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { SiteDrawingAdapterRegistry } from './adapters/site-drawing-adapter-registry';
import type { DiscoveredDrawing } from './adapters/drawing-source-adapter.interface';
import { fallbackMapSourceStatus } from './site-drawing-workflow';

export interface SiteDrawingSyncOutcome {
  status: 'SUCCESS' | 'FAILED';
  drawingsSeen: number;
  drawingsCreated: number;
  revisionsCreated: number;
  errorMessage?: string;
}

interface SiteDrawingRow {
  id: string;
  currentRevisionId: string | null;
}

interface SiteDrawingRevisionRow {
  id: string;
  revisionNumber: string;
}

// The server-side sync job (brief section 6: "server-side sync jobs that
// are idempotent, implement reasonable retry logic, and log failures").
// Walks every company with an active SharePoint connection, and every
// project mapped to a SharePoint site within it, pulling the adapter's own
// listDrawings() and reconciling it into the register.
//
// Idempotent: re-running against unchanged source data creates nothing new
// -- reconcileDrawing() only inserts a drawing/revision when the source
// file or its revision number is genuinely new, and otherwise only
// refreshes metadata + last_verified_at. "Retry logic" here is the cron's
// own next tick, not a per-call backoff loop -- a project whose sync
// failed this run is simply tried again next run, with the failure
// recorded (never silently dropped) in site_drawing_sync_log either way.
//
// NOT built in this pass: a distributed lock across multiple API
// instances. The in-process `running` guard below only prevents this ONE
// instance from starting an overlapping sweep; a multi-instance
// deployment could still run two sweeps concurrently. Flagged here rather
// than silently assumed safe.
@Injectable()
export class SiteDrawingSyncService {
  private readonly logger = new Logger(SiteDrawingSyncService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly adapters: SiteDrawingAdapterRegistry,
  ) {}

  // Every 15 minutes -- frequent enough that a new or changed drawing
  // shows up within one site visit's worth of waiting, not so frequent
  // that it hammers a customer's SharePoint tenant for a register that,
  // in practice, changes a handful of times a day.
  @Cron('*/15 * * * *')
  async handleCron(): Promise<void> {
    if (this.running) {
      this.logger.warn('Skipping this sync tick -- a previous sweep is still running.');
      return;
    }
    this.running = true;
    try {
      const result = await this.syncAllActiveConnections();
      if (result.projectsSynced > 0 || result.projectsFailed > 0) {
        this.logger.log(`Site drawing sync sweep: ${result.projectsSynced} project(s) synced, ${result.projectsFailed} failed.`);
      }
    } catch (err) {
      this.logger.error('Site drawing sync sweep failed unexpectedly', err as Error);
    } finally {
      this.running = false;
    }
  }

  // Scans across EVERY company -- withSystemBypass is required here (same
  // reasoning as IssueWarningService/ScreenshotsService's own retention
  // crons): doc_integrations has a tenant_isolation RLS policy, and there
  // is no single company_id to scope a cron-triggered, cross-tenant sweep
  // to ahead of time.
  async syncAllActiveConnections(): Promise<{ projectsSynced: number; projectsFailed: number }> {
    const connections = await this.db.withSystemBypass(sql => sql<{ companyId: string; config: { projectSites?: Record<string, unknown> } }[]>`
      SELECT company_id, config FROM doc_integrations WHERE system = 'sharepoint' AND is_active = true
    `);

    let projectsSynced = 0;
    let projectsFailed = 0;
    for (const connection of connections) {
      const projectIds = Object.keys(connection.config.projectSites ?? {});
      for (const projectId of projectIds) {
        const outcome = await this.syncProject(connection.companyId, projectId, 'sharepoint').catch((err: unknown) => ({
          status: 'FAILED' as const, drawingsSeen: 0, drawingsCreated: 0, revisionsCreated: 0,
          errorMessage: err instanceof Error ? err.message : 'Unknown sync error',
        }));
        if (outcome.status === 'SUCCESS') projectsSynced++; else projectsFailed++;
      }
    }
    return { projectsSynced, projectsFailed };
  }

  // One project's sync run, start to finish -- always writes exactly one
  // site_drawing_sync_log row and updates doc_integrations' last-attempted/
  // last-successful facts, whether it succeeds or fails. Never throws past
  // this point without having first recorded the failure (section 6: "a
  // failed synchronization must never falsely report success," which cuts
  // both ways -- a real failure must also never go unrecorded).
  async syncProject(companyId: string, projectId: string, provider: SiteDrawingSourceProvider): Promise<SiteDrawingSyncOutcome> {
    const adapter = this.adapters.resolve(provider);
    if (!adapter) throw new Error(`No adapter registered for provider '${provider}'.`);

    const startedAt = new Date();
    let drawingsSeen = 0;
    let drawingsCreated = 0;
    let revisionsCreated = 0;

    try {
      const discovered = await adapter.listDrawings(companyId, projectId);
      drawingsSeen = discovered.length;
      const seenSourceFileIds: string[] = [];

      for (const d of discovered) {
        seenSourceFileIds.push(d.sourceFileId);
        const reconciled = await this.reconcileDrawing(companyId, projectId, provider, d);
        if (reconciled === 'created') drawingsCreated++;
        if (reconciled === 'revision_added') revisionsCreated++;
      }

      // Deletion detection (brief section 6) -- only reached after a FULLY
      // successful listDrawings() above, never on a partial/failed sweep;
      // an empty discovered[] from a genuinely empty library still runs
      // this (correctly withdraws everything), but a thrown error above
      // skips straight to the catch block below and never reaches here.
      await this.markMissingAsWithdrawn(companyId, projectId, provider, seenSourceFileIds);

      await this.writeSyncLog(companyId, projectId, provider, startedAt, 'SUCCESS', drawingsSeen, drawingsCreated, revisionsCreated, null);
      await this.touchConnectionSyncFacts(companyId, provider, true, null);
      return { status: 'SUCCESS', drawingsSeen, drawingsCreated, revisionsCreated };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown sync error';
      await this.writeSyncLog(companyId, projectId, provider, startedAt, 'FAILED', drawingsSeen, drawingsCreated, revisionsCreated, errorMessage);
      await this.touchConnectionSyncFacts(companyId, provider, false, errorMessage);
      // Re-thrown so a caller that wants to know (the manual "sync now"
      // endpoint) sees the real failure -- syncAllActiveConnections() above
      // is the only caller that deliberately swallows it, to keep sweeping
      // the rest of the connections after one project's failure.
      throw err;
    }
  }

  // Creates a new drawing+revision when the source file is genuinely new,
  // adds a new (superseding) revision when its revision number has
  // changed, or just refreshes metadata/verification timestamp when
  // nothing has -- the three cases brief section 10's "prevent duplicate
  // sync jobs ... from creating duplicate records" actually distinguishes.
  private async reconcileDrawing(companyId: string, projectId: string, provider: SiteDrawingSourceProvider, d: DiscoveredDrawing): Promise<'created' | 'revision_added' | 'unchanged'> {
    const adapter = this.adapters.resolve(provider);
    const workflowStatus: SiteDrawingWorkflowStatus = adapter?.mapStatus ? adapter.mapStatus(d.sourceStatusRaw) : fallbackMapSourceStatus(d.sourceStatusRaw);

    return this.db.withTenant(companyId, async (sql) => {
      const [existing] = await sql<SiteDrawingRow[]>`
        SELECT id, current_revision_id FROM site_drawings
        WHERE project_id = ${projectId} AND source_provider = ${provider} AND source_file_id = ${d.sourceFileId}
      `;

      if (!existing) {
        const [drawing] = await sql<{ id: string }[]>`
          INSERT INTO site_drawings (
            company_id, project_id, drawing_number, drawing_title, discipline, building_or_zone, floor_or_level,
            source_provider, source_file_id, source_web_url, current_workflow_status
          ) VALUES (
            ${companyId}, ${projectId}, ${d.drawingNumber}, ${d.drawingTitle}, ${d.discipline ?? null},
            ${d.buildingOrZone ?? null}, ${d.floorOrLevel ?? null}, ${provider}, ${d.sourceFileId}, ${d.sourceWebUrl ?? null}, ${workflowStatus}
          ) RETURNING id
        `;
        const [revision] = await sql<{ id: string }[]>`
          INSERT INTO site_drawing_revisions (
            company_id, project_id, drawing_id, revision_number, workflow_status, source_status_raw, issue_date,
            source_modified_at, source_web_url, file_size_bytes, synchronization_status, last_verified_at
          ) VALUES (
            ${companyId}, ${projectId}, ${drawing.id}, ${d.revisionNumber}, ${workflowStatus}, ${d.sourceStatusRaw ?? null},
            ${d.issueDate ?? null}, ${d.sourceModifiedAt ?? null}, ${d.sourceWebUrl ?? null}, ${d.fileSizeBytes ?? null}, 'SYNCED', now()
          ) RETURNING id
        `;
        await sql`UPDATE site_drawings SET current_revision_id = ${revision.id} WHERE id = ${drawing.id}`;
        return 'created' as const;
      }

      const [currentRevision] = existing.currentRevisionId
        ? await sql<SiteDrawingRevisionRow[]>`SELECT id, revision_number FROM site_drawing_revisions WHERE id = ${existing.currentRevisionId}`
        : [];

      // Refresh metadata either way -- a drawing's title/discipline/
      // location/web URL at the source can change without a new revision.
      await sql`
        UPDATE site_drawings SET
          drawing_title = ${d.drawingTitle}, discipline = ${d.discipline ?? null}, building_or_zone = ${d.buildingOrZone ?? null},
          floor_or_level = ${d.floorOrLevel ?? null}, source_web_url = ${d.sourceWebUrl ?? null}
        WHERE id = ${existing.id}
      `;

      if (currentRevision && currentRevision.revisionNumber === d.revisionNumber) {
        // Same revision -- re-verify it, don't create a duplicate.
        await sql`
          UPDATE site_drawing_revisions SET
            workflow_status = ${workflowStatus}, source_status_raw = ${d.sourceStatusRaw ?? null},
            source_modified_at = ${d.sourceModifiedAt ?? null}, source_web_url = ${d.sourceWebUrl ?? null},
            file_size_bytes = ${d.fileSizeBytes ?? null}, synchronization_status = 'SYNCED', last_verified_at = now()
          WHERE id = ${currentRevision.id}
        `;
        await sql`UPDATE site_drawings SET current_workflow_status = ${workflowStatus} WHERE id = ${existing.id}`;
        return 'unchanged' as const;
      }

      // A new revision -- the previous current revision (if any) is
      // superseded, never deleted (brief section 5).
      const [newRevision] = await sql<{ id: string }[]>`
        INSERT INTO site_drawing_revisions (
          company_id, project_id, drawing_id, revision_number, workflow_status, source_status_raw, issue_date,
          source_modified_at, source_web_url, file_size_bytes, supersedes_revision_id, synchronization_status, last_verified_at
        ) VALUES (
          ${companyId}, ${projectId}, ${existing.id}, ${d.revisionNumber}, ${workflowStatus}, ${d.sourceStatusRaw ?? null},
          ${d.issueDate ?? null}, ${d.sourceModifiedAt ?? null}, ${d.sourceWebUrl ?? null}, ${d.fileSizeBytes ?? null},
          ${currentRevision?.id ?? null}, 'SYNCED', now()
        ) RETURNING id
      `;
      if (currentRevision) {
        await sql`UPDATE site_drawing_revisions SET is_superseded = true WHERE id = ${currentRevision.id}`;
      }
      await sql`
        UPDATE site_drawings SET current_revision_id = ${newRevision.id}, current_workflow_status = ${workflowStatus}, current_is_superseded = false
        WHERE id = ${existing.id}
      `;
      return 'revision_added' as const;
    });
  }

  // "Deletion detection" (brief section 6) -- a drawing this project
  // previously knew about from this provider, no longer present in a
  // full, successful listing, is marked WITHDRAWN rather than silently
  // left showing as if still current. Never deleted from the register
  // (section 5: historical revisions stay accessible).
  private async markMissingAsWithdrawn(companyId: string, projectId: string, provider: SiteDrawingSourceProvider, seenSourceFileIds: string[]): Promise<void> {
    await this.db.withTenant(companyId, async (sql) => {
      const stale = await sql<{ id: string; currentRevisionId: string | null }[]>`
        SELECT id, current_revision_id FROM site_drawings
        WHERE project_id = ${projectId} AND source_provider = ${provider}
          AND current_workflow_status != 'WITHDRAWN'
          AND NOT (source_file_id = ANY(${seenSourceFileIds}))
      `;
      for (const row of stale) {
        if (row.currentRevisionId) {
          await sql`UPDATE site_drawing_revisions SET workflow_status = 'WITHDRAWN' WHERE id = ${row.currentRevisionId}`;
        }
        await sql`UPDATE site_drawings SET current_workflow_status = 'WITHDRAWN' WHERE id = ${row.id}`;
      }
    });
  }

  private async writeSyncLog(
    companyId: string, projectId: string, provider: SiteDrawingSourceProvider, startedAt: Date,
    status: 'SUCCESS' | 'FAILED', drawingsSeen: number, drawingsCreated: number, revisionsCreated: number, errorMessage: string | null,
  ): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO site_drawing_sync_log (
        company_id, project_id, source_provider, started_at, finished_at, status,
        drawings_seen, drawings_created, revisions_created, error_message
      ) VALUES (
        ${companyId}, ${projectId}, ${provider}, ${startedAt.toISOString()}, now(), ${status},
        ${drawingsSeen}, ${drawingsCreated}, ${revisionsCreated}, ${errorMessage}
      )
    `);
  }

  // last_synced_at tracks the last SUCCESSFUL run; last_attempted_sync_at
  // tracks every attempt, success or failure -- the separation brief
  // section 6 calls for, finally wired up now that there's a real sync job
  // to drive it (migration 073 added the columns, this is their first
  // writer).
  private async touchConnectionSyncFacts(companyId: string, provider: SiteDrawingSourceProvider, success: boolean, errorMessage: string | null): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      UPDATE doc_integrations SET
        last_attempted_sync_at = now(),
        last_synced_at = CASE WHEN ${success} THEN now() ELSE last_synced_at END,
        last_sync_error = ${errorMessage}
      WHERE company_id = ${companyId} AND system = ${provider}
    `);
  }
}
