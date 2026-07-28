import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import type { CreateTimelineEntryDto } from './dto/create-entry.dto';

@Injectable()
export class TimelineService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  async create(companyId: string, projectId: string, userId: string, dto: CreateTimelineEntryDto) {
    const [entry] = await this.db.query`
      INSERT INTO timeline_entries (
        company_id, project_id, location_id, capture_id,
        phase, entry_date, title, description, work_type, created_by
      ) VALUES (
        ${companyId}, ${projectId}, ${dto.locationId ?? null}, ${dto.captureId ?? null},
        ${dto.phase}, ${dto.entryDate}, ${dto.title},
        ${dto.description ?? null}, ${dto.workType ?? null}, ${userId}
      ) RETURNING *`;
    return entry;
  }

  // Full project timeline — grouped by month for calendar view
  async getProjectTimeline(companyId: string, projectId: string, query: {
    phase?: string; locationId?: string; dateFrom?: string; dateTo?: string;
  }) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT te.*,
        u.first_name || ' ' || u.last_name AS created_by_name,
        loc.name AS location_name,
        c.capture_type, c.title AS capture_title,
        TO_CHAR(te.entry_date, 'YYYY-MM') AS month_group
      FROM timeline_entries te
      LEFT JOIN users u ON u.id = te.created_by
      LEFT JOIN locations loc ON loc.id = te.location_id
      LEFT JOIN captures c ON c.id = te.capture_id
      WHERE te.project_id = ${projectId} AND te.company_id = ${companyId}
        AND (${query.phase ?? null}::text IS NULL OR te.phase = ${query.phase ?? null})
        AND (${query.locationId ?? null}::uuid IS NULL OR te.location_id = ${query.locationId ?? null}::uuid)
        AND (${query.dateFrom ?? null}::date IS NULL OR te.entry_date >= ${query.dateFrom ?? null}::date)
        AND (${query.dateTo ?? null}::date IS NULL OR te.entry_date <= ${query.dateTo ?? null}::date)
      ORDER BY te.entry_date DESC, te.created_at DESC
    `);
  }

  // Location history — all captures at one location across time (the core timeline UX)
  async getLocationHistory(companyId: string, projectId: string, locationId: string) {
    const captures = await this.db.withTenant(companyId, sql => sql`
      SELECT
        c.id, c.capture_type, c.captured_at, c.phase, c.title, c.status,
        c.compass_heading_deg,
        TO_CHAR(c.captured_at, 'YYYY-MM') AS month_group,
        cr_thumb.storage_key AS thumbnail_key,
        cr_prev.storage_key  AS preview_key,
        te.title AS timeline_title, te.work_type, te.phase AS timeline_phase
      FROM captures c
      LEFT JOIN capture_renditions cr_thumb ON cr_thumb.capture_id = c.id AND cr_thumb.rendition_type = 'thumbnail_sm'
      LEFT JOIN capture_renditions cr_prev  ON cr_prev.capture_id  = c.id AND cr_prev.rendition_type  = 'preview'
      LEFT JOIN timeline_entries te ON te.capture_id = c.id AND te.location_id = ${locationId}
      WHERE c.location_id = ${locationId}
        AND c.project_id = ${projectId}
        AND c.company_id = ${companyId}
        AND c.status = 'ready'
      ORDER BY c.captured_at ASC
    `);

    const keys = captures.flatMap(c => [c.thumbnailKey, c.previewKey].filter(Boolean)) as string[];
    const urlMap = await this.storage.resolveUrls(keys);

    return captures.map(c => ({
      ...c,
      thumbnailUrl: c.thumbnailKey ? urlMap.get(c.thumbnailKey as string) : undefined,
      previewUrl:   c.previewKey   ? urlMap.get(c.previewKey as string)   : undefined,
    }));
  }

  // Side-by-side comparison — two captures at the same location, different dates
  async getComparison(companyId: string, captureIdA: string, captureIdB: string) {
    const captures = await this.db.withTenant(companyId, sql => sql`
      SELECT c.id, c.capture_type, c.captured_at, c.phase, c.title,
             c.location_id, c.original_key,
             cr.storage_key AS preview_key
      FROM captures c
      LEFT JOIN capture_renditions cr ON cr.capture_id = c.id AND cr.rendition_type = 'preview'
      WHERE c.id IN (${captureIdA}, ${captureIdB}) AND c.company_id = ${companyId}
    `);

    if (captures.length < 2) return null;

    const keys = captures.map(c => c.previewKey ?? c.originalKey).filter(Boolean) as string[];
    const urlMap = await this.storage.resolveUrls(keys);

    return captures.map(c => ({
      ...c,
      imageUrl: urlMap.get((c.previewKey ?? c.originalKey) as string),
    }));
  }

  // Phase progression overview for the dashboard
  async getPhaseOverview(companyId: string, projectId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT
        phase,
        COUNT(*)                   AS entry_count,
        COUNT(DISTINCT location_id) AS location_count,
        COUNT(capture_id)          AS capture_count,
        MIN(entry_date)            AS first_entry,
        MAX(entry_date)            AS last_entry
      FROM timeline_entries
      WHERE project_id = ${projectId} AND company_id = ${companyId}
      GROUP BY phase
      ORDER BY MIN(entry_date)
    `);
  }
}