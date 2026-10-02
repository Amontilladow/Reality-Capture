import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { CompanyRole } from '@engineeringos/types';
import { DatabaseService } from '../../../database/database.service';
import { StorageService } from '../../storage/storage.service';
import { resolveVisibleTargetUserId } from '../workforce-visibility.util';
import type { RecordScreenshotDto } from './dto/record-screenshot.dto';

const DEFAULT_RANGE_DAYS = 7;
// A desktop/laptop screen capture, JPEG-compressed. Generous ceiling for a
// single frame; not a video, so nowhere near the capture-module's limits.
const MAX_SCREENSHOT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class ScreenshotsService {
  private readonly logger = new Logger(ScreenshotsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  // The one enforcement point named in the brief: it must not be possible
  // to get a valid upload URL when the company has screenshots off,
  // regardless of what any client (the agent included) believes its own
  // config says.
  async getUploadUrl(companyId: string, userId: string) {
    await this.assertScreenshotsEnabled(companyId);
    const key = this.storage.generateWorkforceScreenshotKey(companyId, userId);
    return this.storage.getUploadUrl(key, 'image/jpeg');
  }

  async record(companyId: string, userId: string, dto: RecordScreenshotDto) {
    // Defense in depth -- don't trust that getUploadUrl() was actually
    // called first, or that screenshot_enabled hasn't been turned off in
    // between the two calls.
    await this.assertScreenshotsEnabled(companyId);

    // A client-supplied storageKey with no ownership check would let a
    // caller record (and later have resolveUrls sign a GET for) any key in
    // the bucket, not just one from their own generateWorkforceScreenshotKey()
    // upload -- including another company's object. Reject anything outside
    // this caller's own namespace before it ever reaches the DB row.
    const expectedPrefix = `${companyId}/workforce-screenshots/${userId}/`;
    if (!dto.storageKey.startsWith(expectedPrefix)) {
      throw new ForbiddenException('storageKey does not belong to this user.');
    }

    // As with every other upload family: never trust that the presigned PUT
    // actually happened, or trust a client-declared size -- verify the real
    // stored object and reject (with cleanup) if it's missing or oversized.
    const actualSizeBytes = await this.storage.getObjectSize(dto.storageKey);
    if (actualSizeBytes === null) {
      throw new BadRequestException('Uploaded file not found in storage. Complete the upload before recording the screenshot.');
    }
    if (actualSizeBytes > MAX_SCREENSHOT_SIZE_BYTES) {
      await this.storage.deleteIfExists(dto.storageKey);
      throw new BadRequestException(
        `Uploaded file (${(actualSizeBytes / 1024 / 1024).toFixed(1)} MB) exceeds the ${MAX_SCREENSHOT_SIZE_BYTES / 1024 / 1024} MB limit for screenshots. The upload has been rejected and removed.`,
      );
    }

    const [row] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO workforce_screenshots (company_id, user_id, device_id, storage_key, captured_at)
      VALUES (${companyId}, ${userId}, ${dto.deviceId ?? null}, ${dto.storageKey}, ${dto.capturedAt})
      RETURNING *`);
    return row;
  }

  // Every caller (self or a manager) hits the same GET /workforce/screenshots/:userId
  // route -- there's no separate "me" shortcut here the way activities/
  // productivity have, since self is just the userId === callerId case of
  // the identical visibility check every other target-user endpoint uses.
  async listForUser(companyId: string, callerId: string, callerCompanyRole: CompanyRole, targetUserId: string, from?: string, to?: string) {
    // Disabling screenshot_enabled is meant to stop exposure of this data,
    // not just new capture -- without this call, a manager with legitimate
    // reporting-line visibility could keep viewing/downloading screenshots
    // captured before the company disabled the feature, for the rest of the
    // retention window (default 90 days).
    await this.assertScreenshotsEnabled(companyId);
    const userId = await resolveVisibleTargetUserId(this.db, companyId, callerId, callerCompanyRole, targetUserId);
    const rangeEnd = to ? new Date(to) : new Date();
    const rangeStart = from ? new Date(from) : new Date(rangeEnd.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

    return this.db.withTenant(companyId, async (sql) => {
      const rows = await sql`
        SELECT id, storage_key, captured_at FROM workforce_screenshots
        WHERE user_id = ${userId}
          AND captured_at >= ${rangeStart.toISOString()}
          AND captured_at < ${rangeEnd.toISOString()}
        ORDER BY captured_at DESC
        LIMIT 500`;

      const urlByKey = await this.storage.resolveUrls(rows.map(r => r.storageKey as string));
      return rows.map(r => ({
        id: r.id as string,
        capturedAt: r.capturedAt as string,
        url: urlByKey.get(r.storageKey as string) ?? null,
      }));
    });
  }

  private async assertScreenshotsEnabled(companyId: string): Promise<void> {
    const [settings] = await this.db.withTenant(companyId, sql => sql`
      SELECT screenshot_enabled FROM workforce_privacy_settings WHERE company_id = ${companyId}`);
    if (!settings?.screenshotEnabled) {
      throw new ForbiddenException({
        code: 'SCREENSHOTS_DISABLED',
        message: 'Screenshot capture is not enabled for this company.',
      });
    }
  }

  // Daily retention sweep. Off-the-hour minute (not :00) so it doesn't
  // cluster with every other midnight/3am cron across every deployment
  // that happens to use a round number.
  //
  // This is cross-company by nature -- it has to look at every company's
  // own retention_days, not just one caller's -- so it can't use
  // withTenant the way every other query in this module does.
  // withSystemBypass required -- see DatabaseService.withSystemBypass() and
  // migration 052, same mechanism TenancyService.register() and
  // IssueWarningService.checkOverdueIssues() use for the same reason.
  @Cron('17 3 * * *')
  async cleanupExpiredScreenshots(): Promise<void> {
    try {
      const companies = await this.db.withSystemBypass(sql => sql`
        SELECT company_id, retention_days FROM workforce_privacy_settings`);

      for (const company of companies) {
        await this.cleanupCompany(company.companyId as string, Number(company.retentionDays));
      }
    } catch (err) {
      this.logger.error('Workforce screenshot retention cleanup failed', err as Error);
    }
  }

  private async cleanupCompany(companyId: string, retentionDays: number): Promise<void> {
    await this.db.withTenant(companyId, async (sql) => {
      const expired = await sql`
        SELECT id, storage_key FROM workforce_screenshots
        WHERE captured_at < NOW() - (${retentionDays} || ' days')::INTERVAL`;

      for (const row of expired) {
        await this.storage.delete(row.storageKey as string).catch((err) => {
          this.logger.warn(`Could not delete storage object for expired screenshot ${row.id as string}: ${(err as Error).message}`);
        });
      }

      if (expired.length > 0) {
        const ids = expired.map(r => r.id as string);
        await sql`DELETE FROM workforce_screenshots WHERE id = ANY(${ids})`;
      }
    });
  }
}
