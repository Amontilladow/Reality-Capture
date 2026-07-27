import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import { StorageService } from '../../storage/storage.service';

export interface ImageProcessingJob {
  captureId: string;
  companyId: string;
  storageKey: string;
  mimeType: string;
  captureType: 'photo_360' | 'photo_standard' | 'video';
}

/**
 * Image Processing Processor
 *
 * Runs in a separate Bull worker — never blocks the API.
 *
 * Phase 2 implementation: the actual image manipulation (resize, thumbnail
 * generation, EXIF extraction) is performed by the Python image-processing
 * microservice, which this processor calls via HTTP. For Phase 1, we mark
 * the capture as ready immediately so the rest of the API can be tested
 * end-to-end without the Python service running.
 *
 * In production (Phase 2+), the Python service:
 *   1. Downloads the original from S3
 *   2. Generates thumbnail_sm (300x300), thumbnail_lg (800x800), preview (1920x960)
 *   3. For 360° images: validates equirectangular 2:1 ratio
 *   4. Extracts EXIF (GPS, timestamp, camera model)
 *   5. Uploads renditions back to S3
 *   6. Returns presigned keys + dimensions
 *   7. This processor writes capture_renditions records and marks status='ready'
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
    const { captureId, companyId, storageKey, captureType } = job.data;
    this.logger.log(`Processing capture ${captureId} (${captureType})`);

    try {
      // Phase 2: call Python image-processing microservice
      // const result = await this.callImageService(job.data);
      // await this.createRenditions(captureId, companyId, result.renditions);

      // Phase 1 stub: mark as ready immediately
      // Remove this block when the Python service is connected in Phase 2
      await this.db.query`
        UPDATE captures
        SET status = 'ready', processed_at = NOW()
        WHERE id = ${captureId}
      `;

      this.logger.log(`Capture ${captureId} marked ready (Phase 1 stub — no image processing yet)`);
    } catch (error) {
      this.logger.error(`Processing failed for capture ${captureId}`, error);
      await this.db.query`
        UPDATE captures
        SET status = 'failed',
            processing_error = ${error instanceof Error ? error.message : 'Unknown error'}
        WHERE id = ${captureId}
      `;
      throw error; // Re-throw so Bull retries the job
    }
  }

  // Called in Phase 2 when Python service is running
  // private async callImageService(data: ImageProcessingJob) {
  //   const response = await fetch(`${process.env.IMAGE_SERVICE_URL}/process`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify(data),
  //   });
  //   if (!response.ok) throw new Error(`Image service error: ${response.status}`);
  //   return response.json();
  // }
}