import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { CompanyRole } from '@engineeringos/types';
import { DatabaseService } from '../../../database/database.service';
import { StorageService } from '../../storage/storage.service';
import { resolveVisibleTargetUserId } from '../workforce-visibility.util';
import type { RecordScreenshotDto } from './dto/record-screenshot.dto';

const DEFAULT_RANGE_DAYS = 7;

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
  // withTenant the way every other query in this module does. Under this
  // app's real production DB role (app_user, no RLS BYPASS -- see
  // migration 001's comments), a cross-tenant read like this has the
  // identical bootstrap-role limitation TenancyService.register() already
  // documents and flags for company self-registration: it needs a
  // narrowly-scoped bypass mechanism this app doesn't have yet, which is a
  // pre-existing, shared gap to fix once, not something to invent here.
  // Written the structurally correct way so it works today under a
  // superuser DB role (e.g. local dev's default `postgres` user, per
  // apps/api/.env.example) and is ready to work in production once that
  // gap is addressed.
  @Cron('17 3 * * *')
  async cleanupExpiredScreenshots(): Promise<void> {
    try {
      const companies = await this.db.withTransaction(sql => sql`
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
