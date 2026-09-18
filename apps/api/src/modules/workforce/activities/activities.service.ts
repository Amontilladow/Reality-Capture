import { Injectable, NotFoundException } from '@nestjs/common';
import type { TransactionSql } from 'postgres';
import type { CompanyRole } from '@engineeringos/types';
import { DatabaseService } from '../../../database/database.service';
import { resolveVisibleTargetUserId } from '../workforce-visibility.util';
import type { IngestActivitiesDto, IngestActivityItemDto } from './dto/ingest-activities.dto';

const DEFAULT_RANGE_DAYS = 7;

@Injectable()
export class ActivitiesService {
  constructor(private readonly db: DatabaseService) {}

  // Idempotent, batched ingestion -- the desktop agent's contract (see
  // docs/workforce-intelligence-api.md). Always writes under the caller's
  // own identity: companyId/userId come from the JWT, never the body, so
  // one enrolled agent cannot post activity for another user.
  async ingest(companyId: string, userId: string, dto: IngestActivitiesDto) {
    return this.db.withTenant(companyId, async (sql) => {
      const items = dto.activities;

      const requestedDeviceIds = [...new Set(items.map(i => i.deviceId).filter((id): id is string => !!id))];
      let ownedDeviceIds = new Set<string>();
      if (requestedDeviceIds.length > 0) {
        const rows = await sql`SELECT id FROM devices WHERE user_id = ${userId} AND id = ANY(${requestedDeviceIds})`;
        ownedDeviceIds = new Set(rows.map(r => r.id as string));
      }

      const appRows = await sql`SELECT id, match_pattern FROM application_registry WHERE is_active = true`;
      const appIdByPattern = new Map(appRows.map(r => [String(r.matchPattern).toLowerCase(), r.id as string]));

      let inserted = 0;
      let duplicates = 0;
      let rejected = 0;

      for (const item of items) {
        const row = await this.insertOne(sql, companyId, userId, item, ownedDeviceIds, appIdByPattern);
        if (row === 'rejected') rejected++;
        else if (row === 'duplicate') duplicates++;
        else inserted++;
      }

      return { total: items.length, inserted, duplicates, rejected };
    });
  }

  // First time this exact app/executable name has been seen for the
  // company, register it as 'unclassified' rather than leaving
  // application_id null -- this is what surfaces it in the admin's
  // Application Productivity screen ready to be classified, mirroring how
  // DeskTime auto-discovers new apps/URLs for the admin to triage instead
  // of requiring them pre-populated. `appIdByPattern` is mutated so later
  // items in the same batch (or a retried batch) hit the map, not another
  // INSERT. ON CONFLICT covers two ingest calls racing to register the
  // same brand-new pattern concurrently.
  private async resolveOrRegisterApplicationId(
    sql: TransactionSql,
    companyId: string,
    userId: string,
    applicationNameRaw: string,
    appIdByPattern: Map<string, string>,
  ): Promise<string> {
    const pattern = applicationNameRaw.toLowerCase();
    const existing = appIdByPattern.get(pattern);
    if (existing) return existing;

    const [created] = await sql`
      INSERT INTO application_registry (company_id, name, match_pattern, productivity_classification, engineering_relevance, created_by)
      VALUES (${companyId}, ${applicationNameRaw}, ${pattern}, 'unclassified', false, ${userId})
      ON CONFLICT (company_id, match_pattern) DO NOTHING
      RETURNING id`;

    let id = created?.id as string | undefined;
    if (!id) {
      const [existingRow] = await sql`SELECT id FROM application_registry WHERE company_id = ${companyId} AND match_pattern = ${pattern}`;
      id = existingRow?.id as string;
    }
    appIdByPattern.set(pattern, id);
    return id;
  }

  private async insertOne(
    sql: TransactionSql,
    companyId: string,
    userId: string,
    item: IngestActivityItemDto,
    ownedDeviceIds: Set<string>,
    appIdByPattern: Map<string, string>,
  ): Promise<'inserted' | 'duplicate' | 'rejected'> {
    const startedAt = new Date(item.startedAt);
    const endedAt = new Date(item.endedAt);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || endedAt.getTime() < startedAt.getTime()) {
      return 'rejected';
    }
    const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    const deviceId = item.deviceId && ownedDeviceIds.has(item.deviceId) ? item.deviceId : null;
    const applicationId = await this.resolveOrRegisterApplicationId(sql, companyId, userId, item.applicationNameRaw, appIdByPattern);

    const [row] = await sql`
      INSERT INTO activities (
        company_id, user_id, device_id, client_event_id, application_id, application_name_raw,
        domain, activity_type, started_at, ended_at, duration_seconds, source, raw_metadata
      ) VALUES (
        ${companyId}, ${userId}, ${deviceId}, ${item.clientEventId ?? null}, ${applicationId}, ${item.applicationNameRaw},
        ${item.domain ?? null}, ${item.activityType}, ${startedAt.toISOString()}, ${endedAt.toISOString()}, ${durationSeconds}, 'agent',
        ${item.rawMetadata ? JSON.stringify(item.rawMetadata) : '{}'}
      )
      ON CONFLICT (device_id, client_event_id) WHERE device_id IS NOT NULL AND client_event_id IS NOT NULL DO NOTHING
      RETURNING id`;

    return row ? 'inserted' : 'duplicate';
  }

  async attribute(companyId: string, userId: string, activityId: string, projectId: string) {
    return this.db.withTenant(companyId, async (sql) => {
      const [activity] = await sql`SELECT id FROM activities WHERE id = ${activityId} AND user_id = ${userId}`;
      if (!activity) throw new NotFoundException({ code: 'ACTIVITY_NOT_FOUND', message: 'Activity not found.' });

      const [project] = await sql`SELECT id FROM projects WHERE id = ${projectId}`;
      if (!project) throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Project not found.' });

      const [attribution] = await sql`
        INSERT INTO activity_project_attributions (company_id, activity_id, project_id, confidence, method, evidence, attributed_by)
        VALUES (${companyId}, ${activityId}, ${projectId}, 1.0, 'manual_selection', '{}', ${userId})
        ON CONFLICT (activity_id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          confidence = EXCLUDED.confidence,
          method = EXCLUDED.method,
          evidence = EXCLUDED.evidence,
          attributed_by = EXCLUDED.attributed_by,
          attributed_at = NOW()
        RETURNING *`;
      return attribution;
    });
  }

  // Own-activity summary for the employee self-view dashboard. Defaults to
  // the trailing 7 days when no range is given. `callerId` is always the
  // authenticated caller; `targetUserId`/`callerCompanyRole` are new,
  // trailing, optional params so every existing self-view call site
  // (which only ever passed the first four arguments) keeps compiling and
  // behaving exactly as before. When a target other than the caller is
  // requested, resolveVisibleTargetUserId() enforces the chain-of-command/
  // leadership visibility rule and throws ForbiddenException if it fails.
  async getMySummary(
    companyId: string,
    callerId: string,
    from?: string,
    to?: string,
    targetUserId?: string,
    callerCompanyRole?: CompanyRole,
  ) {
    const userId = await resolveVisibleTargetUserId(this.db, companyId, callerId, callerCompanyRole, targetUserId);
    const rangeEnd = to ? new Date(to) : new Date();
    const rangeStart = from ? new Date(from) : new Date(rangeEnd.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

    return this.db.withTenant(companyId, async (sql) => {
      const rows = await sql`
        SELECT
          a.id, a.started_at, a.ended_at, a.duration_seconds, a.activity_type,
          a.application_name_raw, ar.name AS application_name,
          apa.project_id, apa.confidence AS attribution_confidence, apa.method AS attribution_method,
          p.name AS project_name
        FROM activities a
        LEFT JOIN application_registry ar ON ar.id = a.application_id
        LEFT JOIN activity_project_attributions apa ON apa.activity_id = a.id
        LEFT JOIN projects p ON p.id = apa.project_id
        WHERE a.user_id = ${userId}
          AND a.started_at >= ${rangeStart.toISOString()}
          AND a.started_at < ${rangeEnd.toISOString()}
        ORDER BY a.started_at DESC
        LIMIT 2000`;

      const totalSeconds = rows.reduce((sum, r) => sum + Number(r.durationSeconds), 0);

      const byApplication = aggregateBy(rows, r => (r.applicationName as string) ?? (r.applicationNameRaw as string));
      const byActivityType = aggregateBy(rows, r => r.activityType as string);
      const byProject = aggregateBy(
        rows.filter(r => r.projectId),
        r => r.projectName as string,
      );

      return {
        rangeStart: rangeStart.toISOString(),
        rangeEnd: rangeEnd.toISOString(),
        totalSeconds,
        activities: rows,
        byApplication,
        byActivityType,
        byProject,
      };
    });
  }
}

function aggregateBy<T extends Record<string, unknown>>(rows: T[], key: (row: T) => string): { label: string; seconds: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const label = key(row) || 'Unknown';
    totals.set(label, (totals.get(label) ?? 0) + Number(row.durationSeconds));
  }
  return [...totals.entries()]
    .map(([label, seconds]) => ({ label, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
}
