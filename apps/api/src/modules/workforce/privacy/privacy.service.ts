import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import type { UpdatePrivacySettingsDto } from './dto/update-privacy-settings.dto';

@Injectable()
export class PrivacyService {
  constructor(private readonly db: DatabaseService) {}

  async get(companyId: string) {
    const [existing] = await this.db.withTenant(companyId, sql => sql`
      SELECT * FROM workforce_privacy_settings WHERE company_id = ${companyId}`);
    if (existing) return existing;

    // Lazily create the default row on first read, rather than requiring a
    // seed step for every company -- defaults match the schema's own
    // DEFAULTs (standard monitoring, screenshots off, self-view on).
    const [created] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO workforce_privacy_settings (company_id) VALUES (${companyId})
      ON CONFLICT (company_id) DO NOTHING
      RETURNING *`);
    if (created) return created;

    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT * FROM workforce_privacy_settings WHERE company_id = ${companyId}`);
    return row;
  }

  async update(companyId: string, userId: string, dto: UpdatePrivacySettingsDto) {
    await this.get(companyId); // ensures a row exists
    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE workforce_privacy_settings SET
        monitoring_level = COALESCE(${dto.monitoringLevel ?? null}, monitoring_level),
        screenshot_enabled = COALESCE(${dto.screenshotEnabled ?? null}, screenshot_enabled),
        window_title_enabled = COALESCE(${dto.windowTitleEnabled ?? null}, window_title_enabled),
        retention_days = COALESCE(${dto.retentionDays ?? null}, retention_days),
        self_view_enabled = COALESCE(${dto.selfViewEnabled ?? null}, self_view_enabled),
        updated_by = ${userId},
        updated_at = NOW()
      WHERE company_id = ${companyId}
      RETURNING *`);
    return updated;
  }
}
