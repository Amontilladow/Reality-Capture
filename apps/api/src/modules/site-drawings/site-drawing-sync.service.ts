import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { SiteDrawingSourceProvider, SiteDrawingWorkflowStatus } from '@engineeringos/types';
import { DatabaseService } from '../../database/database.service';
import { SiteDrawingAdapterRegistry } from './adapters/site-drawing-adapter-registry';
import type { DiscoveredDrawing } from './adapters/drawing-source-adapter.interface';
import { fallbackMapSourceStatus } from './site-drawing-workflow';
import { titlesCompatible } from './extraction/identity-match';
import { compareRevisionOrder } from './extraction/revision-order';

export interface SiteDrawingSyncOutcome {
  status: 'SUCCESS' | 'FAILED';
  drawingsSeen: number;
  drawingsCreated: number;
  revisionsCreated: number;
  // A cross-source match (same drawing_number, different provider) left
  // un-promoted pending a human decision in the Review Queue -- migration
  // 087's own cross-source identity fix.
  conflictsCreated: number;
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
// Idempotent: re-running against unchanged source data creates nothing new;
// reconcileDrawing() only inserts a drawing/revision when the source
// file or its revision number is new, and otherwise only
// refreshes metadata + last_verified_at. "Retry logic" here is the cron's
// own next tick, not a per-call backoff loop; a project whose sync
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

  // Every 15 minutes: frequent enough that a new or changed drawing
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

  // Scans across EVERY company: withSystemBypass is required here (same
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
          status: 'FAILED' as const, drawingsSeen: 0, drawingsCreated: 0, revisionsCreated: 0, conflictsCreated: 0,
          errorMessage: err instanceof Error ? err.message : 'Unknown sync error',
        }));
        if (outcome.status === 'SUCCESS') projectsSynced++; else projectsFailed++;
      }
    }
    return { projectsSynced, projectsFailed };
  }

  // One project's sync run, start to finish; always writes exactly one
  // site_drawing_sync_log row and updates doc_integrations' last-attempted/
  // last-successful facts, whether it succeeds or fails. Never throws past
  // this point without having first recorded the failure (section 6: "a
  // failed synchronization must never falsely report success," which cuts
  // both ways; a real failure must also never go unrecorded).
  async syncProject(companyId: string, projectId: string, provider: SiteDrawingSourceProvider): Promise<SiteDrawingSyncOutcome> {
    const adapter = this.adapters.resolve(provider);
    if (!adapter) throw new Error(`No adapter registered for provider '${provider}'.`);

    const startedAt = new Date();
    let drawingsSeen = 0;
    let drawingsCreated = 0;
    let revisionsCreated = 0;
    let conflictsCreated = 0;

    try {
      const discovered = await adapter.listDrawings(companyId, projectId);
      drawingsSeen = discovered.length;
      const seenSourceFileIds: string[] = [];

      for (const d of discovered) {
        seenSourceFileIds.push(d.sourceFileId);
        const reconciled = await this.reconcileDrawing(companyId, projectId, provider, d);
        if (reconciled === 'created') drawingsCreated++;
        if (reconciled === 'revision_added') revisionsCreated++;
        if (reconciled === 'conflict') conflictsCreated++;
      }

      // Deletion detection (brief section 6): only reached after a FULLY
      // successful listDrawings() above, never on a partial/failed sweep;
      // an empty discovered[] from a empty library still runs
      // this (correctly withdraws everything), but a thrown error above
      // skips straight to the catch block below and never reaches here.
      await this.markMissingAsWithdrawn(companyId, projectId, provider, seenSourceFileIds);

      await this.writeSyncLog(companyId, projectId, provider, startedAt, 'SUCCESS', drawingsSeen, drawingsCreated, revisionsCreated, conflictsCreated, null);
      await this.touchConnectionSyncFacts(companyId, provider, true, null);
      return { status: 'SUCCESS', drawingsSeen, drawingsCreated, revisionsCreated, conflictsCreated };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown sync error';
      await this.writeSyncLog(companyId, projectId, provider, startedAt, 'FAILED', drawingsSeen, drawingsCreated, revisionsCreated, conflictsCreated, errorMessage);
      await this.touchConnectionSyncFacts(companyId, provider, false, errorMessage);
      // Re-thrown so a caller that wants to know (the manual "sync now"
      // endpoint) sees the real failure; syncAllActiveConnections() above
      // is the only caller that deliberately swallows it, to keep sweeping
      // the rest of the connections after one project's failure.
      throw err;
    }
  }

  // Creates a new drawing+revision when the source file is new, adds a new
  // (superseding) revision when its revision number has changed, or just
  // refreshes metadata/verification timestamp when nothing has. A fourth
  // outcome, added by migration 087's cross-source identity fix: a
  // drawing_number that already exists in this project from a DIFFERENT
  // provider is never silently registered a second time (confirmed against
  // production data: the same physical drawing, synced from both Procore
  // and SharePoint, was registering as two completely separate drawings,
  // neither lookup able to see the other's row). The incoming file's
  // revision is instead attached to the EXISTING drawing -- auto-promoted
  // only when the title also matches and the revision-order comparison is
  // unambiguous (the same bar SiteDrawingImportProcessor.reconcile() sets
  // for its own identical ambiguity), otherwise left CONFLICT for the
  // Review Queue (SiteDrawingImportService.confirmRevisionAsNew() /
  // splitRevisionAsNewDrawing() already drive that decision generically,
  // by revisionId, regardless of which pipeline created the pending
  // revision).
  private async reconcileDrawing(
    companyId: string, projectId: string, provider: SiteDrawingSourceProvider, d: DiscoveredDrawing,
  ): Promise<'created' | 'revision_added' | 'unchanged' | 'conflict'> {
    const adapter = this.adapters.resolve(provider);
    const workflowStatus: SiteDrawingWorkflowStatus = adapter?.mapStatus ? adapter.mapStatus(d.sourceStatusRaw) : fallbackMapSourceStatus(d.sourceStatusRaw);

    return this.db.withTenant(companyId, async (sql) => {
      // Has THIS exact source file already been reconciled before, on
      // whichever drawing it ended up attached to? Scoped by the
      // REVISION's own source columns (migration 087), not site_drawings'
      // -- a file that was folded into another provider's existing drawing
      // (the cross-source branch below) still needs to be found here on
      // every later sync tick, or it would look "never seen" and create a
      // duplicate CONFLICT revision every 15 minutes.
      const [existingRevision] = await sql<{ id: string; drawingId: string; revisionNumber: string }[]>`
        SELECT id, drawing_id, revision_number FROM site_drawing_revisions
        WHERE project_id = ${projectId} AND source_provider = ${provider} AND source_file_id = ${d.sourceFileId}
      `;

      if (existingRevision) {
        const [drawing] = await sql<SiteDrawingRow[]>`SELECT id, current_revision_id FROM site_drawings WHERE id = ${existingRevision.drawingId}`;
        const isCurrent = drawing.currentRevisionId === existingRevision.id;

        if (!isCurrent) {
          // This provider's own file is no longer what drives the
          // drawing's current state (it was cross-source-merged and a
          // later revision from another provider took over). Keep its
          // own tracked state fresh in place -- never create a new row or
          // touch current_revision_id; that decision belongs to whichever
          // provider's revision IS current.
          await sql`
            UPDATE site_drawing_revisions SET
              revision_number = ${d.revisionNumber}, workflow_status = ${workflowStatus}, source_status_raw = ${d.sourceStatusRaw ?? null},
              source_modified_at = ${d.sourceModifiedAt ?? null}, source_web_url = ${d.sourceWebUrl ?? null},
              file_size_bytes = ${d.fileSizeBytes ?? null}, synchronization_status = 'SYNCED', last_verified_at = now()
            WHERE id = ${existingRevision.id}
          `;
          return 'unchanged' as const;
        }

        // Refresh metadata either way: a drawing's title/discipline/
        // location/web URL at the source can change without a new revision.
        await sql`
          UPDATE site_drawings SET
            drawing_title = ${d.drawingTitle}, discipline = ${d.discipline ?? null}, building_or_zone = ${d.buildingOrZone ?? null},
            floor_or_level = ${d.floorOrLevel ?? null}, source_web_url = ${d.sourceWebUrl ?? null}
          WHERE id = ${drawing.id}
        `;

        if (existingRevision.revisionNumber === d.revisionNumber) {
          // Same revision: re-verify it, don't create a duplicate.
          await sql`
            UPDATE site_drawing_revisions SET
              workflow_status = ${workflowStatus}, source_status_raw = ${d.sourceStatusRaw ?? null},
              source_modified_at = ${d.sourceModifiedAt ?? null}, source_web_url = ${d.sourceWebUrl ?? null},
              file_size_bytes = ${d.fileSizeBytes ?? null}, synchronization_status = 'SYNCED', last_verified_at = now()
            WHERE id = ${existingRevision.id}
          `;
          await sql`UPDATE site_drawings SET current_workflow_status = ${workflowStatus} WHERE id = ${drawing.id}`;
          return 'unchanged' as const;
        }

        // A new revision from the SAME source that has always owned this
        // drawing's identity: the previous current revision is superseded,
        // never deleted (brief section 5). No identity ambiguity here --
        // it's the same tracked file, just a later version of it.
        const [newRevision] = await sql<{ id: string }[]>`
          INSERT INTO site_drawing_revisions (
            company_id, project_id, drawing_id, revision_number, workflow_status, source_status_raw, issue_date,
            source_modified_at, source_web_url, file_size_bytes, supersedes_revision_id, synchronization_status, last_verified_at,
            source_provider, source_file_id
          ) VALUES (
            ${companyId}, ${projectId}, ${drawing.id}, ${d.revisionNumber}, ${workflowStatus}, ${d.sourceStatusRaw ?? null},
            ${d.issueDate ?? null}, ${d.sourceModifiedAt ?? null}, ${d.sourceWebUrl ?? null}, ${d.fileSizeBytes ?? null},
            ${existingRevision.id}, 'SYNCED', now(), ${provider}, ${d.sourceFileId}
          ) RETURNING id
        `;
        await sql`UPDATE site_drawing_revisions SET is_superseded = true WHERE id = ${existingRevision.id}`;
        await sql`
          UPDATE site_drawings SET current_revision_id = ${newRevision.id}, current_workflow_status = ${workflowStatus}, current_is_superseded = false
          WHERE id = ${drawing.id}
        `;
        return 'revision_added' as const;
      }

      // Never seen this exact source file before. Does a drawing with the
      // same number already exist in this project, from ANY provider?
      const [sameNumberDrawing] = await sql<{ id: string; drawingTitle: string; currentRevisionId: string | null }[]>`
        SELECT id, drawing_title, current_revision_id FROM site_drawings
        WHERE project_id = ${projectId} AND drawing_number = ${d.drawingNumber}
      `;

      if (!sameNumberDrawing) {
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
            source_modified_at, source_web_url, file_size_bytes, synchronization_status, last_verified_at,
            source_provider, source_file_id
          ) VALUES (
            ${companyId}, ${projectId}, ${drawing.id}, ${d.revisionNumber}, ${workflowStatus}, ${d.sourceStatusRaw ?? null},
            ${d.issueDate ?? null}, ${d.sourceModifiedAt ?? null}, ${d.sourceWebUrl ?? null}, ${d.fileSizeBytes ?? null}, 'SYNCED', now(),
            ${provider}, ${d.sourceFileId}
          ) RETURNING id
        `;
        await sql`UPDATE site_drawings SET current_revision_id = ${revision.id} WHERE id = ${drawing.id}`;
        return 'created' as const;
      }

      // Cross-source match: this drawing_number is already registered, but
      // from a DIFFERENT provider (if it were this same provider, the
      // lookup above would already have found it by source_file_id --
      // every drawing/revision this service itself creates always tags its
      // own provider/file). Never silently creates a second site_drawings
      // row for it; the incoming file's revision is attached to the
      // EXISTING drawing instead.
      const [currentRevision] = sameNumberDrawing.currentRevisionId
        ? await sql<SiteDrawingRevisionRow[]>`SELECT id, revision_number FROM site_drawing_revisions WHERE id = ${sameNumberDrawing.currentRevisionId}`
        : [];
      const titleMatch = titlesCompatible(sameNumberDrawing.drawingTitle, d.drawingTitle);
      const chronology = currentRevision ? compareRevisionOrder(currentRevision.revisionNumber, d.revisionNumber) : 'incoming_newer';
      const canAutoPromote = titleMatch && chronology === 'incoming_newer';

      const [newRevision] = await sql<{ id: string }[]>`
        INSERT INTO site_drawing_revisions (
          company_id, project_id, drawing_id, revision_number, workflow_status, source_status_raw, issue_date,
          source_modified_at, source_web_url, file_size_bytes, supersedes_revision_id, synchronization_status, last_verified_at,
          source_provider, source_file_id, extraction_status
        ) VALUES (
          ${companyId}, ${projectId}, ${sameNumberDrawing.id}, ${d.revisionNumber}, ${workflowStatus}, ${d.sourceStatusRaw ?? null},
          ${d.issueDate ?? null}, ${d.sourceModifiedAt ?? null}, ${d.sourceWebUrl ?? null}, ${d.fileSizeBytes ?? null},
          ${canAutoPromote ? (currentRevision?.id ?? null) : null}, 'SYNCED', now(),
          ${provider}, ${d.sourceFileId}, ${canAutoPromote ? 'CONFIRMED' : 'CONFLICT'}
        ) RETURNING id
      `;

      if (!canAutoPromote) return 'conflict' as const;

      if (currentRevision) await sql`UPDATE site_drawing_revisions SET is_superseded = true WHERE id = ${currentRevision.id}`;
      await sql`
        UPDATE site_drawings SET current_revision_id = ${newRevision.id}, current_workflow_status = ${workflowStatus}, current_is_superseded = false
        WHERE id = ${sameNumberDrawing.id}
      `;
      return 'revision_added' as const;
    });
  }

  // "Deletion detection" (brief section 6): a drawing whose CURRENT
  // revision was last synced from this provider, and is no longer present
  // in a full, successful listing, is marked WITHDRAWN rather than
  // silently left showing as if still current. Scoped by the current
  // revision's own source_provider (migration 087), not site_drawings' --
  // a drawing another provider's revision is now driving must never be
  // withdrawn just because ITS original provider stopped reporting it;
  // that provider no longer gets a say in what's current. Never deleted
  // from the register either way (section 5: historical revisions stay
  // accessible).
  private async markMissingAsWithdrawn(companyId: string, projectId: string, provider: SiteDrawingSourceProvider, seenSourceFileIds: string[]): Promise<void> {
    await this.db.withTenant(companyId, async (sql) => {
      const stale = await sql<{ id: string; currentRevisionId: string | null }[]>`
        SELECT d.id, d.current_revision_id FROM site_drawings d
        JOIN site_drawing_revisions r ON r.id = d.current_revision_id
        WHERE d.project_id = ${projectId} AND r.source_provider = ${provider}
          AND d.current_workflow_status != 'WITHDRAWN'
          AND NOT (r.source_file_id = ANY(${seenSourceFileIds}))
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
    status: 'SUCCESS' | 'FAILED', drawingsSeen: number, drawingsCreated: number, revisionsCreated: number, conflictsCreated: number, errorMessage: string | null,
  ): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      INSERT INTO site_drawing_sync_log (
        company_id, project_id, source_provider, started_at, finished_at, status,
        drawings_seen, drawings_created, revisions_created, conflicts_created, error_message
      ) VALUES (
        ${companyId}, ${projectId}, ${provider}, ${startedAt.toISOString()}, now(), ${status},
        ${drawingsSeen}, ${drawingsCreated}, ${revisionsCreated}, ${conflictsCreated}, ${errorMessage}
      )
    `);
  }

  // last_synced_at tracks the last SUCCESSFUL run; last_attempted_sync_at
  // tracks every attempt, success or failure; the separation brief
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
