import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { AiClientService } from '../ai-client/ai-client.service';
import type { UploadUrlDto } from './dto/upload-url.dto';
import type { RegisterCaptureDto } from './dto/register-capture.dto';
import type { UpdateCaptureDto } from './dto/update-capture.dto';
import type { CreateHotspotDto } from './dto/create-hotspot.dto';
import type { SyncCapturesDto } from './dto/sync-captures.dto';
import type { PaginationQuery } from '@engineeringos/types';

// Max file sizes
const MAX_SIZE_360   = 100 * 1024 * 1024; // 100 MB
const MAX_SIZE_PHOTO =  20 * 1024 * 1024; //  20 MB
const MAX_SIZE_VIDEO = 500 * 1024 * 1024; // 500 MB

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'video/mp4', 'video/quicktime',
]);

@Injectable()
export class CapturesService {
  private readonly logger = new Logger(CapturesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly tenancy: TenancyService,
    private readonly aiClient: AiClientService,
    @InjectQueue('image-processing') private readonly queue: Queue,
  ) {}

  // ── Get presigned upload URL ──────────────────────────────────────────────
  // Client uploads directly to S3 — our API never handles the binary data.
  // On completion, client calls registerCapture() to create the DB record.
  async getUploadUrl(companyId: string, projectId: string, dto: UploadUrlDto) {
    // Validate file type
    if (!ALLOWED_MIME.has(dto.mimeType)) {
      throw new BadRequestException(`File type ${dto.mimeType} is not supported. Allowed: JPEG, PNG, WebP, MP4, MOV.`);
    }

    // Validate file size
    const maxSize = dto.captureType === 'photo_360' ? MAX_SIZE_360
      : dto.captureType === 'video' ? MAX_SIZE_VIDEO
      : MAX_SIZE_PHOTO;

    if (dto.sizeBytes > maxSize) {
      throw new BadRequestException(
        `File too large (${(dto.sizeBytes / 1024 / 1024).toFixed(1)} MB). Max for ${dto.captureType}: ${maxSize / 1024 / 1024} MB.`
      );
    }

    // Check storage quota
    const limitCheck = await this.checkStorageLimit(companyId, dto.sizeBytes);
    if (!limitCheck.allowed) throw new ForbiddenException(limitCheck.reason);

    const key = this.storage.generateKey(companyId, projectId, 'captures', dto.filename);
    const { uploadUrl } = await this.storage.getUploadUrl(key, dto.mimeType, dto.sizeBytes);

    return {
      uploadUrl,
      storageKey: key,
      expiresIn: 900, // 15 minutes to complete the upload
    };
  }

  // ── Register capture after upload ─────────────────────────────────────────
  async register(companyId: string, projectId: string, userId: string, dto: RegisterCaptureDto) {
    // Validate location belongs to this project if provided
    if (dto.locationId) {
      const [loc] = await this.db.withTenant(companyId, sql => sql`
        SELECT l.id FROM locations l
        JOIN levels lv ON lv.id = l.level_id
        JOIN buildings b ON b.id = lv.building_id
        WHERE l.id = ${dto.locationId} AND b.project_id = ${projectId}
      `);
      if (!loc) throw new BadRequestException('Location does not belong to this project.');
    }

    const [capture] = await this.db.query`
      INSERT INTO captures (
        company_id, project_id, location_id, captured_by,
        capture_type, phase, title, description, tags,
        captured_at, original_key, original_size_bytes, original_mime_type,
        original_width_px, original_height_px,
        gps_lat, gps_lng, gps_accuracy_m, compass_heading_deg,
        status
      ) VALUES (
        ${companyId}, ${projectId}, ${dto.locationId ?? null}, ${userId},
        ${dto.captureType}, ${dto.phase ?? null}, ${dto.title ?? null},
        ${dto.description ?? null}, ${dto.tags ? JSON.stringify(dto.tags) : '{}'},
        ${dto.capturedAt}, ${dto.storageKey}, ${dto.originalSizeBytes},
        ${dto.originalMimeType}, ${dto.originalWidthPx ?? null}, ${dto.originalHeightPx ?? null},
        ${dto.gpsLat ?? null}, ${dto.gpsLng ?? null},
        ${dto.gpsAccuracyM ?? null}, ${dto.compassHeadingDeg ?? null},
        'processing'
      )
      RETURNING *
    `;

    // Update company storage usage
    await this.tenancy.incrementStorage(companyId, dto.originalSizeBytes);

    // Queue image processing — thumbnail, preview, metadata extraction
    await this.queue.add('process-capture', {
      captureId: capture.id,
      companyId,
      storageKey: dto.storageKey,
      mimeType: dto.originalMimeType,
      captureType: dto.captureType,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    this.logger.log(`Capture ${capture.id as string} registered, queued for processing`);

    // Make the capture searchable via AI search/assistant. Fire-and-forget —
    // never blocks or fails the upload response if the AI service is down.
    this.aiClient.ingestCapture({
      id: capture.id as string,
      companyId,
      projectId,
      title: capture.title as string | null,
      description: capture.description as string | null,
      captureType: capture.captureType as string,
      phase: capture.phase as string | null,
      capturedAt: (capture.capturedAt as Date)?.toISOString?.() ?? (capture.capturedAt as string),
    });

    return capture;
  }

  // ── List captures ─────────────────────────────────────────────────────────
  async findAll(companyId: string, projectId: string, query: PaginationQuery & {
    locationId?: string;
    phase?: string;
    captureType?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const page    = query.page ?? 1;
    const perPage = Math.min(query.perPage ?? 20, 100);
    const offset  = (page - 1) * perPage;

    const rows = await this.db.withTenant(companyId, sql => sql`
      SELECT
        c.*,
        u.first_name || ' ' || u.last_name AS captured_by_name,
        loc.name AS location_name,
        json_agg(
          json_build_object(
            'type', cr.rendition_type,
            'key',  cr.storage_key
          )
        ) FILTER (WHERE cr.id IS NOT NULL) AS renditions,
        COUNT(*) OVER() AS full_count
      FROM captures c
      LEFT JOIN users u ON u.id = c.captured_by
      LEFT JOIN locations loc ON loc.id = c.location_id
      LEFT JOIN capture_renditions cr ON cr.capture_id = c.id
      WHERE c.project_id = ${projectId}
        AND c.company_id = ${companyId}
        AND (${query.locationId ?? null}::uuid IS NULL OR c.location_id = ${query.locationId ?? null})
        AND (${query.phase ?? null}::text IS NULL OR c.phase = ${query.phase ?? null})
        AND (${query.captureType ?? null}::text IS NULL OR c.capture_type = ${query.captureType ?? null})
        AND (${query.status ?? null}::text IS NULL OR c.status = ${query.status ?? null})
        AND (${query.dateFrom ?? null}::timestamptz IS NULL OR c.captured_at >= ${query.dateFrom ?? null}::timestamptz)
        AND (${query.dateTo ?? null}::timestamptz IS NULL OR c.captured_at <= ${query.dateTo ?? null}::timestamptz)
        AND (${query.search ?? null}::text IS NULL OR
          to_tsvector('english', coalesce(c.title,'') || ' ' || coalesce(c.description,''))
          @@ plainto_tsquery('english', ${query.search ?? null}))
      GROUP BY c.id, u.first_name, u.last_name, loc.name
      ORDER BY c.captured_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    // Resolve presigned URLs for renditions and originals (fallback when no rendition exists yet)
    const allKeys: string[] = [];
    rows.forEach(row => {
      const rends = row.renditions as Array<{ type: string; key: string }> | null;
      if (rends) rends.forEach(r => allKeys.push(r.key));
      if (row.originalKey) allKeys.push(row.originalKey as string);
    });

    const urlMap = await this.storage.resolveUrls(allKeys);

    const data = rows.map(row => {
      const rends = row.renditions as Array<{ type: string; key: string }> | null;
      const originalUrl = urlMap.get(row.originalKey as string);
      return {
        ...row,
        renditions: rends?.map(r => ({ ...r, url: urlMap.get(r.key) })),
        thumbnailUrl: (rends?.find(r => r.type === 'thumbnail_sm') ? urlMap.get(rends.find(r => r.type === 'thumbnail_sm')!.key) : undefined) ?? originalUrl,
        previewUrl: (rends?.find(r => r.type === 'preview') ? urlMap.get(rends.find(r => r.type === 'preview')!.key) : undefined) ?? originalUrl,
      };
    });

    return this.db.paginate(data, page, perPage);
  }

  // ── Get single capture with full detail ───────────────────────────────────
  async findOne(companyId: string, projectId: string, captureId: string) {
    const [capture] = await this.db.withTenant(companyId, sql => sql`
      SELECT
        c.*,
        u.first_name || ' ' || u.last_name AS captured_by_name,
        u.avatar_url AS captured_by_avatar,
        loc.name AS location_name,
        json_agg(DISTINCT jsonb_build_object(
          'id', cr.id, 'type', cr.rendition_type,
          'key', cr.storage_key, 'widthPx', cr.width_px, 'heightPx', cr.height_px
        )) FILTER (WHERE cr.id IS NOT NULL) AS renditions,
        json_agg(DISTINCT jsonb_build_object(
          'id', h.id, 'type', h.hotspot_type, 'label', h.label,
          'yawDeg', h.yaw_deg, 'pitchDeg', h.pitch_deg,
          'targetCaptureId', h.target_capture_id, 'iconName', h.icon_name, 'color', h.color
        )) FILTER (WHERE h.id IS NOT NULL) AS hotspots
      FROM captures c
      LEFT JOIN users u ON u.id = c.captured_by
      LEFT JOIN locations loc ON loc.id = c.location_id
      LEFT JOIN capture_renditions cr ON cr.capture_id = c.id
      LEFT JOIN hotspots h ON h.source_capture_id = c.id
      WHERE c.id = ${captureId} AND c.project_id = ${projectId} AND c.company_id = ${companyId}
      GROUP BY c.id, u.first_name, u.last_name, u.avatar_url, loc.name
    `);

    if (!capture) throw new NotFoundException(`Capture ${captureId} not found.`);

    // Resolve URLs
    const rends = capture.renditions as Array<{ key: string; type: string }> | null;
    const keys  = rends?.map(r => r.key) ?? [];
    keys.push(capture.originalKey as string);
    const urlMap = await this.storage.resolveUrls(keys);

    return {
      ...capture,
      originalUrl: urlMap.get(capture.originalKey as string),
      renditions: rends?.map(r => ({ ...r, url: urlMap.get(r.key) })),
      thumbnailUrl: (rends?.find(r => r.type === 'thumbnail_sm') ? urlMap.get(rends.find(r => r.type === 'thumbnail_sm')!.key) : undefined) ?? urlMap.get(capture.originalKey as string),
      previewUrl: (rends?.find(r => r.type === 'preview') ? urlMap.get(rends.find(r => r.type === 'preview')!.key) : undefined) ?? urlMap.get(capture.originalKey as string),
    };
  }

  // ── Update capture metadata ───────────────────────────────────────────────
  async update(companyId: string, projectId: string, captureId: string, dto: UpdateCaptureDto) {
    await this.findOne(companyId, projectId, captureId);
    const [updated] = await this.db.query`
      UPDATE captures SET
        title       = COALESCE(${dto.title ?? null}, title),
        description = COALESCE(${dto.description ?? null}, description),
        phase       = COALESCE(${dto.phase ?? null}, phase),
        tags        = COALESCE(${dto.tags ? JSON.stringify(dto.tags) : null}::text[], tags),
        location_id = COALESCE(${dto.locationId ?? null}, location_id),
        updated_at  = NOW()
      WHERE id = ${captureId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *
    `;
    return updated;
  }

  // ── Delete capture ────────────────────────────────────────────────────────
  async delete(companyId: string, projectId: string, captureId: string) {
    const capture = await this.findOne(companyId, projectId, captureId);

    // Get all storage keys (original + renditions) for cleanup
    const renditions = await this.db.query`
      SELECT storage_key FROM capture_renditions WHERE capture_id = ${captureId}
    `;

    // Delete DB record (cascades to renditions, hotspots, links)
    await this.db.query`
      DELETE FROM captures WHERE id = ${captureId} AND company_id = ${companyId}
    `;

    // Clean up storage (fire-and-forget — don't fail delete if storage cleanup fails)
    const keys = [
      (capture as any).originalKey as string,
      ...renditions.map(r => r.storageKey as string),
    ];
    Promise.allSettled(keys.map(k => this.storage.delete(k))).catch(err =>
      this.logger.error('Storage cleanup failed', err),
    );

    // Update storage usage
    await this.tenancy.decrementStorage(companyId, (capture as any).originalSizeBytes as number);

    return { message: 'Capture deleted.' };
  }

  // ── Hotspots ──────────────────────────────────────────────────────────────
  async createHotspot(companyId: string, captureId: string, userId: string, dto: CreateHotspotDto) {
    const [hotspot] = await this.db.query`
      INSERT INTO hotspots (
        source_capture_id, target_capture_id, company_id,
        hotspot_type, label, content, yaw_deg, pitch_deg,
        icon_name, color, created_by
      ) VALUES (
        ${captureId}, ${dto.targetCaptureId ?? null}, ${companyId},
        ${dto.hotspotType}, ${dto.label ?? null}, ${dto.content ?? null},
        ${dto.yawDeg}, ${dto.pitchDeg},
        ${dto.iconName ?? null}, ${dto.color ?? null}, ${userId}
      )
      RETURNING *
    `;
    return hotspot;
  }

  async updateHotspot(companyId: string, captureId: string, hotspotId: string, dto: Partial<CreateHotspotDto>) {
    const [updated] = await this.db.query`
      UPDATE hotspots SET
        label            = COALESCE(${dto.label ?? null}, label),
        content          = COALESCE(${dto.content ?? null}, content),
        yaw_deg          = COALESCE(${dto.yawDeg ?? null}, yaw_deg),
        pitch_deg        = COALESCE(${dto.pitchDeg ?? null}, pitch_deg),
        target_capture_id = COALESCE(${dto.targetCaptureId ?? null}, target_capture_id)
      WHERE id = ${hotspotId} AND source_capture_id = ${captureId} AND company_id = ${companyId}
      RETURNING *
    `;
    if (!updated) throw new NotFoundException('Hotspot not found.');
    return updated;
  }

  async deleteHotspot(companyId: string, captureId: string, hotspotId: string) {
    await this.db.query`
      DELETE FROM hotspots
      WHERE id = ${hotspotId} AND source_capture_id = ${captureId} AND company_id = ${companyId}
    `;
    return { message: 'Hotspot deleted.' };
  }

  // ── Mobile batch sync ─────────────────────────────────────────────────────
  // Processes captures queued offline on the mobile app.
  // Idempotency key prevents duplicates if the sync request is retried.
  async syncFromMobile(companyId: string, projectId: string, userId: string, dto: SyncCapturesDto) {
    const results: Array<{ idempotencyKey: string; captureId: string | null; status: string; error?: string }> = [];

    for (const item of dto.captures) {
      try {
        // Check if already processed (idempotency)
        const [existing] = await this.db.query`
          SELECT id FROM captures
          WHERE company_id = ${companyId}
            AND original_key = ${item.storageKey}
            AND captured_by = ${userId}
        `;

        if (existing) {
          results.push({ idempotencyKey: item.idempotencyKey, captureId: existing.id as string, status: 'already_processed' });
          continue;
        }

        const capture = await this.register(companyId, projectId, userId, {
          storageKey: item.storageKey,
          originalSizeBytes: item.originalSizeBytes,
          originalMimeType: item.originalMimeType,
          captureType: item.captureType,
          capturedAt: item.capturedAt,
          locationId: item.locationId,
          phase: item.phase,
          title: item.title,
          gpsLat: item.gpsLat,
          gpsLng: item.gpsLng,
          compassHeadingDeg: item.compassHeadingDeg,
        });

        results.push({ idempotencyKey: item.idempotencyKey, captureId: capture.id as string, status: 'created' });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        results.push({ idempotencyKey: item.idempotencyKey, captureId: null, status: 'failed', error: msg });
        this.logger.error(`Sync failed for key ${item.idempotencyKey}`, error);
      }
    }

    const created = results.filter(r => r.status === 'created').length;
    const failed  = results.filter(r => r.status === 'failed').length;

    return { results, summary: { total: dto.captures.length, created, failed, skipped: dto.captures.length - created - failed } };
  }

  // ── Viewer data — all captures at a location for walkthrough ─────────────
  async getViewerData(companyId: string, projectId: string, locationId: string) {
    const captures = await this.db.withTenant(companyId, sql => sql`
      SELECT c.id, c.capture_type, c.captured_at, c.phase, c.title,
             c.compass_heading_deg, c.original_key,
             cp.scene_x, cp.scene_y, cp.scene_z, cp.plan_x, cp.plan_y, cp.yaw_deg,
             cr_thumb.storage_key AS thumbnail_key,
             cr_prev.storage_key  AS preview_key,
             json_agg(DISTINCT jsonb_build_object(
               'id', h.id, 'type', h.hotspot_type, 'label', h.label,
               'yawDeg', h.yaw_deg, 'pitchDeg', h.pitch_deg,
               'targetCaptureId', h.target_capture_id, 'iconName', h.icon_name
             )) FILTER (WHERE h.id IS NOT NULL) AS hotspots
      FROM captures c
      LEFT JOIN capture_points cp ON cp.capture_id = c.id
      LEFT JOIN capture_renditions cr_thumb ON cr_thumb.capture_id = c.id AND cr_thumb.rendition_type = 'thumbnail_sm'
      LEFT JOIN capture_renditions cr_prev  ON cr_prev.capture_id  = c.id AND cr_prev.rendition_type  = 'preview'
      LEFT JOIN hotspots h ON h.source_capture_id = c.id
      WHERE c.location_id = ${locationId}
        AND c.project_id = ${projectId}
        AND c.company_id = ${companyId}
        AND c.status = 'ready'
      GROUP BY c.id, cp.scene_x, cp.scene_y, cp.scene_z, cp.plan_x, cp.plan_y, cp.yaw_deg,
               cr_thumb.storage_key, cr_prev.storage_key
      ORDER BY c.captured_at DESC
    `);

    const keys = captures.flatMap(c => [c.thumbnailKey, c.previewKey, c.originalKey].filter(Boolean)) as string[];
    const urlMap = await this.storage.resolveUrls(keys);

    return captures.map(c => ({
      ...c,
      thumbnailUrl: (c.thumbnailKey ? urlMap.get(c.thumbnailKey as string) : undefined) ?? urlMap.get(c.originalKey as string),
      previewUrl:   (c.previewKey   ? urlMap.get(c.previewKey as string)   : undefined) ?? urlMap.get(c.originalKey as string),
    }));
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  private async checkStorageLimit(companyId: string, additionalBytes: number): Promise<{ allowed: boolean; reason?: string }> {
    const [data] = await this.db.query`
      SELECT c.storage_used_bytes,
             COALESCE(cs.custom_storage_bytes, sp.max_storage_bytes) AS max_bytes
      FROM companies c
      LEFT JOIN company_subscriptions cs ON cs.company_id = c.id
      LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
      WHERE c.id = ${companyId}
    `;
    if (!data) return { allowed: false, reason: 'Company not found.' };
    if (data.maxBytes === null) return { allowed: true }; // unlimited
    if (Number(data.storageUsedBytes) + additionalBytes > Number(data.maxBytes)) {
      return { allowed: false, reason: 'Storage limit reached. Delete captures or upgrade your plan.' };
    }
    return { allowed: true };
  }
}