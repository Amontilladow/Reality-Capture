import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import type { CreateDrawingDto } from './dto/create-drawing.dto';
import type { LinkCaptureToDrawingDto } from './dto/link-capture.dto';
import type { CreatePinDto } from './dto/create-pin.dto';

@Injectable()
export class DrawingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  async getUploadUrl(companyId: string, projectId: string, filename: string) {
    const key = this.storage.generateKey(companyId, projectId, 'drawings', filename);
    const url = await this.storage.getUploadUrl(key, 'application/pdf', 100 * 1024 * 1024);
    return { ...url, storageKey: key };
  }

  async create(companyId: string, projectId: string, userId: string, dto: CreateDrawingDto) {
    const [drawing] = await this.db.query`
      INSERT INTO drawings (
        company_id, project_id, level_id, location_id, title, drawing_number, revision,
        drawing_type, storage_key, width_px, height_px,
        scale_ratio, scale_px_per_m, is_current, uploaded_by
      ) VALUES (
        ${companyId}, ${projectId}, ${dto.levelId ?? null}, ${dto.locationId ?? null}, ${dto.title},
        ${dto.drawingNumber ?? null}, ${dto.revision ?? null},
        ${dto.drawingType ?? null}, ${dto.storageKey},
        ${dto.widthPx ?? null}, ${dto.heightPx ?? null},
        ${dto.scaleRatio ?? null}, ${dto.scalePxPerM ?? null},
        true, ${userId}
      ) RETURNING *`;
    return drawing;
  }

  async findAll(companyId: string, projectId: string, levelId?: string) {
    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT d.*, u.first_name || ' ' || u.last_name AS uploaded_by_name,
        l.name AS level_name,
        COUNT(cdl.capture_id) AS linked_capture_count
      FROM drawings d
      LEFT JOIN users u ON u.id = d.uploaded_by
      LEFT JOIN levels l ON l.id = d.level_id
      LEFT JOIN capture_drawing_links cdl ON cdl.drawing_id = d.id
      WHERE d.project_id = ${projectId} AND d.company_id = ${companyId}
        AND d.is_current = true
        AND (${levelId ?? null}::uuid IS NULL OR d.level_id = ${levelId ?? null}::uuid)
      GROUP BY d.id, u.first_name, u.last_name, l.name
      ORDER BY l.name NULLS LAST, d.title
    `);
    return rows;
  }

  async findOne(companyId: string, drawingId: string) {
    const [drawing] = await this.db.withTenant(companyId, sql => sql`
      SELECT d.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'id', cdl.id, 'captureId', cdl.capture_id,
          'posXNorm', cdl.pos_x_norm, 'posYNorm', cdl.pos_y_norm,
          'captureType', c.capture_type, 'capturedAt', c.captured_at,
          'phase', c.phase, 'title', c.title, 'status', c.status
        )) FILTER (WHERE cdl.id IS NOT NULL), '[]'::json) AS capture_links
      FROM drawings d
      LEFT JOIN capture_drawing_links cdl ON cdl.drawing_id = d.id
      LEFT JOIN captures c ON c.id = cdl.capture_id AND c.status = 'ready'
      WHERE d.id = ${drawingId} AND d.company_id = ${companyId}
      GROUP BY d.id
    `);
    if (!drawing) throw new NotFoundException('Drawing not found.');

    const url = await this.storage.getReadUrl(drawing.storageKey as string);
    return { ...drawing, downloadUrl: url };
  }

  async linkCapture(companyId: string, drawingId: string, userId: string, dto: LinkCaptureToDrawingDto) {
    const [link] = await this.db.query`
      INSERT INTO capture_drawing_links (capture_id, drawing_id, company_id, pos_x_norm, pos_y_norm, linked_by)
      VALUES (${dto.captureId}, ${drawingId}, ${companyId}, ${dto.posXNorm}, ${dto.posYNorm}, ${userId})
      ON CONFLICT (capture_id, drawing_id) DO UPDATE SET pos_x_norm = ${dto.posXNorm}, pos_y_norm = ${dto.posYNorm}
      RETURNING *
    `;
    return link;
  }

  async unlinkCapture(companyId: string, drawingId: string, captureId: string) {
    await this.db.query`
      DELETE FROM capture_drawing_links
      WHERE drawing_id = ${drawingId} AND capture_id = ${captureId} AND company_id = ${companyId}
    `;
    return { message: 'Capture unlinked from drawing.' };
  }

  // Return all capture pins for a floor plan — used by the web viewer
  async getFloorPlanData(companyId: string, drawingId: string) {
    const drawing = await this.findOne(companyId, drawingId);
    const pins = await this.db.withTenant(companyId, sql => sql`
      SELECT cdl.pos_x_norm, cdl.pos_y_norm,
             c.id AS capture_id, c.location_id, c.capture_type, c.captured_at, c.phase,
             c.title, c.compass_heading_deg,
             cr.storage_key AS thumbnail_key
      FROM capture_drawing_links cdl
      JOIN captures c ON c.id = cdl.capture_id AND c.status = 'ready'
      LEFT JOIN capture_renditions cr ON cr.capture_id = c.id AND cr.rendition_type = 'thumbnail_sm'
      WHERE cdl.drawing_id = ${drawingId} AND cdl.company_id = ${companyId}
      ORDER BY c.captured_at DESC
    `);

    const keys = pins.map(p => p.thumbnailKey as string).filter(Boolean);
    const urlMap = await this.storage.resolveUrls(keys);

    return {
      drawing,
      pins: pins.map(p => ({
        ...p,
        thumbnailUrl: p.thumbnailKey ? urlMap.get(p.thumbnailKey as string) : undefined,
      })),
    };
  }

  // ── Pins (place-first model — a pin is a Location that can exist before ──
  // any capture does; captures attach to it afterward via captures.location_id)

  async createPin(companyId: string, drawingId: string, dto: CreatePinDto) {
    const [drawing] = await this.db.withTenant(companyId, sql => sql`
      SELECT id, level_id FROM drawings WHERE id = ${drawingId} AND company_id = ${companyId}
    `);
    if (!drawing) throw new NotFoundException('Drawing not found.');

    const [pin] = await this.db.query`
      INSERT INTO locations (company_id, level_id, name, drawing_id, pos_x_norm, pos_y_norm, created_via)
      VALUES (
        ${companyId}, ${drawing.levelId ?? null}, ${dto.name ?? 'Untitled pin'},
        ${drawingId}, ${dto.posXNorm}, ${dto.posYNorm}, 'floor_plan_tap'
      )
      RETURNING *
    `;

    // Shaped to match getPins() below (locationId, captureCount, etc.) so the
    // frontend can treat a freshly-created pin identically to one from the list.
    return {
      locationId: pin.id as string,
      name: pin.name as string,
      posXNorm: pin.posXNorm as number,
      posYNorm: pin.posYNorm as number,
      createdVia: pin.createdVia as string,
      createdAt: pin.createdAt as string,
      captureCount: 0,
    };
  }

  // Pins for a drawing — one marker per place, not per photo. A place with
  // several photos attached still shows as a single pin with a capture count.
  async getPins(companyId: string, drawingId: string) {
    const pins = await this.db.withTenant(companyId, sql => sql`
      SELECT
        loc.id AS location_id, loc.name, loc.pos_x_norm, loc.pos_y_norm,
        loc.created_via, loc.created_at,
        COUNT(c.id) AS capture_count,
        MAX(c.captured_at) AS latest_captured_at,
        (ARRAY_AGG(cr.storage_key ORDER BY c.captured_at DESC)
          FILTER (WHERE cr.storage_key IS NOT NULL))[1] AS thumbnail_key,
        (ARRAY_AGG(c.compass_heading_deg ORDER BY c.captured_at DESC)
          FILTER (WHERE c.compass_heading_deg IS NOT NULL))[1] AS compass_heading_deg
      FROM locations loc
      LEFT JOIN captures c ON c.location_id = loc.id AND c.status = 'ready'
      LEFT JOIN capture_renditions cr ON cr.capture_id = c.id AND cr.rendition_type = 'thumbnail_sm'
      WHERE loc.drawing_id = ${drawingId} AND loc.company_id = ${companyId}
      GROUP BY loc.id
      ORDER BY loc.created_at DESC
    `);

    const keys = pins.map(p => p.thumbnailKey as string).filter(Boolean);
    const urlMap = await this.storage.resolveUrls(keys);

    return pins.map(p => ({
      ...p,
      thumbnailUrl: p.thumbnailKey ? urlMap.get(p.thumbnailKey as string) : undefined,
    }));
  }
}