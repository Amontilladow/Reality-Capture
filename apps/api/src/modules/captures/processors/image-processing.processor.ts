import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import sharp from 'sharp';
import * as exifr from 'exifr';
import { DatabaseService } from '../../../database/database.service';
import { StorageService } from '../../storage/storage.service';

export interface ImageProcessingJob {
  captureId: string;
  companyId: string;
  projectId: string;
  storageKey: string;
  mimeType: string;
  captureType: 'photo_360' | 'photo_standard' | 'video';
}

interface RenditionSpec {
  type: 'thumbnail_sm' | 'thumbnail_lg' | 'preview';
  build: (pipeline: sharp.Sharp) => sharp.Sharp;
  quality: number;
}

// EXIF orientation values 5-8 mean the image is rotated 90/270 degrees --
// the visually-correct width/height are swapped relative to the raw
// encoded pixel grid sharp's metadata() reports.
function isSidewaysOrientation(orientation: number | undefined): boolean {
  return orientation !== undefined && orientation >= 5 && orientation <= 8;
}

/**
 * Image Processing Processor
 *
 * Runs in a separate Bull worker -- never blocks the API. Photos
 * (photo_360, photo_standard) get real thumbnail/preview renditions and
 * EXIF/GPS extraction via sharp + exifr. Video captures are left as a
 * pass-through (no frame extraction/thumbnailing) -- that would need
 * ffmpeg, a separate scope not covered by the original Phase 1 -> Phase 2
 * design this replaces (see git history for the removed Python-microservice
 * stub comment).
 */
@Processor('image-processing')
export class ImageProcessingProcessor {
  private readonly logger = new Logger(ImageProcessingProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  @Process('process-capture')
  async handleProcessCapture(job: Job<ImageProcessingJob>): Promise<void> {
    const { captureId, companyId, projectId, storageKey, captureType } = job.data;
    this.logger.log(`Processing capture ${captureId} (${captureType})`);

    try {
      if (captureType === 'video') {
        // withTenant required -- captures carries the tenant_isolation RLS policy. A plain
        // this.db.query() never sets app.current_company_id, so under any DB role that isn't
        // the table owner/a superuser this UPDATE silently touches 0 rows.
        await this.db.withTenant(companyId, sql => sql`UPDATE captures SET status = 'ready', processed_at = NOW() WHERE id = ${captureId} AND company_id = ${companyId}`);
        this.logger.log(`Capture ${captureId} marked ready (video -- no thumbnailing).`);
        return;
      }

      const original = await this.storage.download(storageKey);
      const metadata = await sharp(original).metadata();
      const sideways = isSidewaysOrientation(metadata.orientation);
      const widthPx = (sideways ? metadata.height : metadata.width) ?? null;
      const heightPx = (sideways ? metadata.width : metadata.height) ?? null;

      if (captureType === 'photo_360' && widthPx && heightPx) {
        const aspect = widthPx / heightPx;
        if (Math.abs(aspect - 2) > 0.05) {
          this.logger.warn(
            `Capture ${captureId} is marked photo_360 but isn't a 2:1 equirectangular image ` +
            `(${widthPx}x${heightPx}, aspect ${aspect.toFixed(3)}). Proceeding anyway -- this is a ` +
            `content-quality warning, not a processing failure.`,
          );
        }
      }

      const renditions = this.buildRenditionSpecs(captureType);
      const uploaded: { type: string; storageKey: string; widthPx: number | null; heightPx: number | null; sizeBytes: number }[] = [];

      for (const spec of renditions) {
        const pipeline = spec.build(sharp(original).rotate());
        const buffer = await pipeline.jpeg({ quality: spec.quality }).toBuffer({ resolveWithObject: true });
        const key = this.storage.generateKey(companyId, projectId, 'captures', `${captureId}-${spec.type}.jpg`);
        await this.storage.upload(key, buffer.data, 'image/jpeg');
        uploaded.push({
          type: spec.type,
          storageKey: key,
          widthPx: buffer.info.width,
          heightPx: buffer.info.height,
          sizeBytes: buffer.info.size,
        });
      }

      // withTenant required -- capture_renditions carries the tenant_isolation RLS policy. A
      // plain this.db.query() never sets app.current_company_id, so under any DB role that
      // isn't the table owner/a superuser this INSERT's implicit WITH CHECK rejects it outright.
      await this.db.withTenant(companyId, async (sql) => {
        for (const r of uploaded) {
          await sql`
            INSERT INTO capture_renditions (capture_id, company_id, rendition_type, storage_key, width_px, height_px, size_bytes)
            VALUES (${captureId}, ${companyId}, ${r.type}, ${r.storageKey}, ${r.widthPx}, ${r.heightPx}, ${r.sizeBytes})
          `;
        }
      });

      // EXIF GPS is a fallback enrichment only -- never overwrite GPS the
      // client already supplied (a live device sensor reading, when
      // present, is more trustworthy than embedded EXIF metadata).
      const gps = await exifr.gps(original).catch(() => null);

      // withTenant required -- see capture_renditions INSERT above.
      await this.db.withTenant(companyId, sql => sql`
        UPDATE captures SET
          status = 'ready',
          processed_at = NOW(),
          original_width_px = COALESCE(original_width_px, ${widthPx}),
          original_height_px = COALESCE(original_height_px, ${heightPx}),
          gps_lat = COALESCE(gps_lat, ${gps?.latitude ?? null}),
          gps_lng = COALESCE(gps_lng, ${gps?.longitude ?? null})
        WHERE id = ${captureId} AND company_id = ${companyId}
      `);

      this.logger.log(`Capture ${captureId} processed: ${uploaded.length} renditions generated.`);
    } catch (error) {
      this.logger.error(`Processing failed for capture ${captureId}`, error);
      // withTenant required -- see capture_renditions INSERT above.
      await this.db.withTenant(companyId, sql => sql`
        UPDATE captures
        SET status = 'failed',
            processing_error = ${error instanceof Error ? error.message : 'Unknown error'}
        WHERE id = ${captureId} AND company_id = ${companyId}
      `);
      throw error; // Re-throw so Bull retries the job
    }
  }

  private buildRenditionSpecs(captureType: 'photo_360' | 'photo_standard'): RenditionSpec[] {
    return [
      { type: 'thumbnail_sm', quality: 78, build: (p) => p.resize(300, 300, { fit: 'cover' }) },
      { type: 'thumbnail_lg', quality: 82, build: (p) => p.resize(800, 800, { fit: 'cover' }) },
      {
        type: 'preview',
        quality: 85,
        build: (p) => captureType === 'photo_360'
          ? p.resize(1920, 960, { fit: 'fill' }) // equirectangular -- must stay exactly 2:1, never letterboxed
          : p.resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }),
      },
    ];
  }
}
