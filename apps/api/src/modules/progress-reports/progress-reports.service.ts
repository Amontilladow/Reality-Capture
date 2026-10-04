import { randomBytes } from 'crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { CapturesService } from '../captures/captures.service';
import { BimService } from '../bim/bim.service';
import { renderProgressReportPdf, type ProgressReportPdfData, type ProgressReportPdfIssueRow } from './progress-report-pdf.template';
import type { GenerateProgressReportShareDto } from './dto/generate-progress-report-share.dto';

const DEFAULT_EXPIRY_DAYS = 14;
// A printed/viewed report with hundreds of thumbnails stops being a quick
// status check -- this caps it to the most recent captures in range while
// still being a real, honest count (reportData.captureCount below carries
// the true total separately, so "60 of 340" is never silently hidden).
const MAX_REPORT_CAPTURES = 60;

export interface ProgressReportFilters {
  buildingId?: string;
  levelId?: string;
  dateFrom: string;
  dateTo: string;
}

interface IssueSummaryRow {
  id: string; issueNumber: string; title: string; status: string; priority: string;
  locationName?: string; assignedToName?: string; deadline?: string; createdAt: string; closedAt?: string;
}

export interface ProgressReportCapture {
  id: string;
  thumbnailUrl?: string;
  capturedAt: string;
  title?: string;
  locationName?: string;
}

export interface ProgressReportLevelSummary {
  levelId: string; levelName: string; buildingName: string;
  elementTotal: number; elementComplete: number; elementCompletionPct: number | null;
  zoneStatus?: string;
}

export interface ProgressReportData {
  project: { name: string; code?: string };
  building?: { name: string };
  level?: { name: string };
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  captureCount: number;
  captures: ProgressReportCapture[];
  newIssues: IssueSummaryRow[];
  closedIssues: IssueSummaryRow[];
  overdueIssues: IssueSummaryRow[];
  blockers: IssueSummaryRow[];
  // F2: planned-vs-actual element/zone completion, scoped by the same
  // building/level filters as everything else in this report. Undefined
  // (not an empty array) when the project has no BIM elements at all, so
  // the UI/PDF can omit the section instead of showing an empty table.
  elementProgress?: { overallCompletionPct: number | null; byLevel: ProgressReportLevelSummary[] };
}

/**
 * F1: Automated Progress Report. A report's content is never persisted --
 * it's computed live from captures/issues at view time, exactly like the
 * general Reports tab's KPI payload (reports.service.ts) -- so an in-app
 * view, a PDF download, and a public share link all read the same real,
 * current data, never a stale snapshot. Only the SHARE itself (which
 * project/building/level/date-range an opaque token authorizes) is
 * persisted, in progress_report_shares (migration 054).
 */
@Injectable()
export class ProgressReportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly captures: CapturesService,
    private readonly bim: BimService,
  ) {}

  async generate(companyId: string, projectId: string, filters: ProgressReportFilters): Promise<ProgressReportData> {
    const [project] = await this.db.withTenant(companyId, sql => sql<{ name: string; code: string | null }[]>`
      SELECT name, code FROM projects WHERE id = ${projectId} AND company_id = ${companyId}`);
    if (!project) throw new NotFoundException('Project not found.');

    const building = filters.buildingId ? await this.getBuildingName(companyId, projectId, filters.buildingId) : undefined;
    const level = filters.levelId ? await this.getLevelName(companyId, projectId, filters.levelId) : undefined;

    const capturesResult = await this.captures.findAll(companyId, projectId, {
      buildingId: filters.buildingId, levelId: filters.levelId,
      dateFrom: filters.dateFrom, dateTo: filters.dateTo,
      page: 1, perPage: MAX_REPORT_CAPTURES,
    });
    // CapturesService.findAll()'s own row type loses its untyped `c.*`
    // columns on the `...row` spread (an index-signature-into-object-
    // literal gap, not introduced here) -- cast at this boundary rather
    // than widen that pre-existing, unrelated service's typing.
    const captureRows = capturesResult.data as unknown as Array<{
      id: string; thumbnailUrl?: string; capturedAt: string; title?: string; locationName?: string;
    }>;

    const [newIssues, closedIssues, overdueIssues, blockers, elementProgress] = await Promise.all([
      this.queryIssues(companyId, projectId, filters, 'new'),
      this.queryIssues(companyId, projectId, filters, 'closed'),
      this.queryIssues(companyId, projectId, filters, 'overdue'),
      this.queryIssues(companyId, projectId, filters, 'blockers'),
      this.getElementProgress(companyId, projectId, filters),
    ]);

    return {
      project: { name: project.name, code: project.code ?? undefined },
      building, level,
      dateFrom: filters.dateFrom, dateTo: filters.dateTo,
      generatedAt: new Date().toISOString(),
      captureCount: capturesResult.total,
      captures: captureRows.map((c): ProgressReportCapture => ({
        id: c.id, thumbnailUrl: c.thumbnailUrl, capturedAt: c.capturedAt, title: c.title, locationName: c.locationName,
      })),
      newIssues, closedIssues, overdueIssues, blockers,
      elementProgress,
    };
  }

  // F2: reuses BimService.getLevelProgressSummary() (the same query the BIM
  // viewer's per-level panel reads) rather than a second, duplicate rollup
  // query here.
  private async getElementProgress(
    companyId: string, projectId: string, filters: ProgressReportFilters,
  ): Promise<{ overallCompletionPct: number | null; byLevel: ProgressReportLevelSummary[] } | undefined> {
    const rows = await this.bim.getLevelProgressSummary(companyId, projectId, {
      buildingId: filters.buildingId, levelId: filters.levelId,
    }) as unknown as Array<{
      levelId: string; levelName: string; buildingName: string;
      elementTotal: number; elementComplete: number; elementCompletionPct: number | null; zoneStatus?: string;
    }>;

    const totalElements = rows.reduce((sum, r) => sum + Number(r.elementTotal), 0);
    if (totalElements === 0) return undefined;

    const totalComplete = rows.reduce((sum, r) => sum + Number(r.elementComplete), 0);
    return {
      overallCompletionPct: Math.round((totalComplete / totalElements) * 1000) / 10,
      byLevel: rows.filter(r => Number(r.elementTotal) > 0).map(r => ({
        levelId: r.levelId, levelName: r.levelName, buildingName: r.buildingName,
        elementTotal: Number(r.elementTotal), elementComplete: Number(r.elementComplete),
        elementCompletionPct: r.elementCompletionPct === null ? null : Number(r.elementCompletionPct),
        zoneStatus: r.zoneStatus,
      })),
    };
  }

  private async getBuildingName(companyId: string, projectId: string, buildingId: string): Promise<{ name: string } | undefined> {
    const [row] = await this.db.withTenant(companyId, sql => sql<{ name: string }[]>`
      SELECT name FROM buildings WHERE id = ${buildingId} AND project_id = ${projectId}`);
    return row;
  }

  private async getLevelName(companyId: string, projectId: string, levelId: string): Promise<{ name: string } | undefined> {
    const [row] = await this.db.withTenant(companyId, sql => sql<{ name: string }[]>`
      SELECT lvl.name FROM levels lvl JOIN buildings b ON b.id = lvl.building_id WHERE lvl.id = ${levelId} AND b.project_id = ${projectId}`);
    return row;
  }

  private async queryIssues(
    companyId: string, projectId: string, filters: ProgressReportFilters,
    kind: 'new' | 'closed' | 'overdue' | 'blockers',
  ): Promise<IssueSummaryRow[]> {
    return this.db.withTenant(companyId, (sql) => {
      const buildingFilter = filters.buildingId ? sql`AND i.building_id = ${filters.buildingId}` : sql``;
      const levelFilter = filters.levelId ? sql`AND i.level_id = ${filters.levelId}` : sql``;
      const condition =
        kind === 'new' ? sql`i.created_at BETWEEN ${filters.dateFrom}::timestamptz AND ${filters.dateTo}::timestamptz` :
        kind === 'closed' ? sql`i.closed_at BETWEEN ${filters.dateFrom}::timestamptz AND ${filters.dateTo}::timestamptz` :
        kind === 'overdue' ? sql`i.deadline < NOW() AND i.status NOT IN ('closed', 'void')` :
        sql`i.priority IN ('critical', 'high') AND i.status NOT IN ('closed', 'void')`;

      return sql<IssueSummaryRow[]>`
        SELECT i.id, i.issue_number, i.title, i.status, i.priority, i.deadline, i.created_at, i.closed_at,
               loc.name AS location_name, u.first_name || ' ' || u.last_name AS assigned_to_name
        FROM issues i
        LEFT JOIN locations loc ON loc.id = i.location_id
        LEFT JOIN users u ON u.id = i.assigned_to
        WHERE i.project_id = ${projectId} AND i.company_id = ${companyId}
          AND ${condition} ${buildingFilter} ${levelFilter}
        ORDER BY i.created_at DESC
        LIMIT 100`;
    });
  }

  // ── Share links (internal, authenticated side) ──────────────────────────
  // Mirrors rfi-external-access.service.ts's generate()/list()/revoke()
  // pattern exactly: a random 128-hex-char token (the secret itself, not
  // hashed -- same category as a password-reset token), never re-selected
  // once issued.

  async createShare(companyId: string, projectId: string, userId: string, dto: GenerateProgressReportShareDto) {
    const token = randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + (dto.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000);

    const [share] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO progress_report_shares (
        company_id, project_id, building_id, level_id, date_from, date_to, token, expires_at, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${dto.buildingId ?? null}, ${dto.levelId ?? null},
        ${dto.dateFrom}, ${dto.dateTo}, ${token}, ${expiresAt.toISOString()}, ${userId}
      )
      RETURNING *`);

    const frontendUrl = this.config.get<string>('app.frontendUrl');
    return { ...share, shareUrl: `${frontendUrl}/progress-report/${token}` };
  }

  // Never selects `token` -- same "don't re-display a bearer credential"
  // practice as rfi-external-access.service.ts's list().
  async listShares(companyId: string, projectId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT id, building_id, level_id, date_from, date_to, expires_at, revoked_at, used_at, created_by, created_at
      FROM progress_report_shares
      WHERE project_id = ${projectId} AND company_id = ${companyId}
      ORDER BY created_at DESC`);
  }

  async revokeShare(companyId: string, projectId: string, shareId: string, userId: string) {
    const [revoked] = await this.db.withTenant(companyId, sql => sql`
      UPDATE progress_report_shares SET revoked_at = NOW(), revoked_by = ${userId}
      WHERE id = ${shareId} AND project_id = ${projectId} AND company_id = ${companyId} AND revoked_at IS NULL
      RETURNING id`);
    if (!revoked) throw new NotFoundException({ code: 'SHARE_NOT_FOUND', message: 'No active share link found with that id.' });
    return { message: 'Share link revoked.' };
  }

  // ── Public, unauthenticated side ────────────────────────────────────────
  // Deliberately global (withSystemBypass, no withTenant) -- the token
  // itself is the only credential; the caller has no session, no
  // company_id. Same bootstrap category as rfi-external-access.service.ts's
  // identical validateToken(). Not single-use -- used_at is "last successful
  // view," matching that same precedent.
  private async validateShareToken(token: string): Promise<Record<string, unknown>> {
    const [share] = await this.db.withSystemBypass(sql => sql`
      SELECT * FROM progress_report_shares WHERE token = ${token} AND expires_at > NOW() AND revoked_at IS NULL`);

    if (!share) {
      const [existing] = await this.db.withSystemBypass(sql => sql`SELECT expires_at, revoked_at FROM progress_report_shares WHERE token = ${token}`);
      if (existing?.revokedAt) {
        throw new ForbiddenException({ code: 'LINK_REVOKED', message: 'This link has been revoked. Ask the project team to send a new one.' });
      }
      if (existing && new Date(existing.expiresAt as string) <= new Date()) {
        throw new ForbiddenException({ code: 'LINK_EXPIRED', message: 'This link has expired. Ask the project team to send a new one.' });
      }
      throw new NotFoundException({ code: 'LINK_INVALID', message: 'This link is invalid.' });
    }

    await this.db.withTenant(share.companyId as string, sql => sql`
      UPDATE progress_report_shares SET used_at = NOW() WHERE id = ${share.id} AND company_id = ${share.companyId}`);

    return share;
  }

  async generateByToken(token: string): Promise<ProgressReportData> {
    const share = await this.validateShareToken(token);
    return this.generate(share.companyId as string, share.projectId as string, {
      buildingId: share.buildingId as string | undefined,
      levelId: share.levelId as string | undefined,
      dateFrom: (share.dateFrom as Date).toISOString(),
      dateTo: (share.dateTo as Date).toISOString(),
    });
  }

  // ── PDF export ───────────────────────────────────────────────────────────
  // aiBriefing-style separation from risk.service.ts's generatePdf() doesn't
  // apply here (no AI narrative in this report) -- this just reuses the
  // exact same generate() data every other view reads, then downloads each
  // capture's thumbnail into a Buffer (storage.download(), same pattern as
  // rfis.service.ts's attachment-image embedding) since @react-pdf/renderer
  // needs raw bytes, not a presigned URL.
  async generatePdf(companyId: string, projectId: string, filters: ProgressReportFilters): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.generate(companyId, projectId, filters);
    const captureKeys = await this.resolveCaptureThumbnailKeys(companyId, projectId, data.captures.map(c => c.id));

    const capturesWithBuffers = await Promise.all(data.captures.map(async (c) => {
      const key = captureKeys.get(c.id);
      const imageBuffer = key ? await this.storage.download(key).catch(() => undefined) : undefined;
      return { title: c.title, locationName: c.locationName, capturedAt: c.capturedAt, imageBuffer };
    }));

    const toRow = (r: IssueSummaryRow): ProgressReportPdfIssueRow => ({
      issueNumber: r.issueNumber, title: r.title, status: r.status, priority: r.priority,
      locationName: r.locationName, assignedToName: r.assignedToName, deadline: r.deadline,
    });

    const pdfData: ProgressReportPdfData = {
      projectName: data.project.name, projectCode: data.project.code,
      buildingName: data.building?.name, levelName: data.level?.name,
      dateFrom: data.dateFrom, dateTo: data.dateTo,
      generatedAt: new Date().toLocaleString('en-GB'),
      captures: capturesWithBuffers,
      elementProgress: data.elementProgress,
      newIssues: data.newIssues.map(toRow),
      closedIssues: data.closedIssues.map(toRow),
      overdueIssues: data.overdueIssues.map(toRow),
      blockers: data.blockers.map(toRow),
    };

    const buffer = await renderProgressReportPdf(pdfData);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${data.project.code ?? 'project'}-progress-report-${date}.pdf`;
    return { buffer, filename };
  }

  private async resolveCaptureThumbnailKeys(companyId: string, projectId: string, captureIds: string[]): Promise<Map<string, string>> {
    if (captureIds.length === 0) return new Map();
    const rows = await this.db.withTenant(companyId, sql => sql<{ id: string; originalKey: string; renditions: Array<{ type: string; key: string }> | null }[]>`
      SELECT c.id, c.original_key,
        COALESCE(json_agg(json_build_object('type', cr.rendition_type, 'key', cr.storage_key)) FILTER (WHERE cr.id IS NOT NULL), '[]'::json) AS renditions
      FROM captures c
      LEFT JOIN capture_renditions cr ON cr.capture_id = c.id
      WHERE c.project_id = ${projectId} AND c.company_id = ${companyId} AND c.id = ANY(${captureIds})
      GROUP BY c.id`);

    const map = new Map<string, string>();
    for (const row of rows) {
      const thumb = row.renditions?.find(r => r.type === 'thumbnail_sm');
      map.set(row.id, thumb?.key ?? row.originalKey);
    }
    return map;
  }
}
