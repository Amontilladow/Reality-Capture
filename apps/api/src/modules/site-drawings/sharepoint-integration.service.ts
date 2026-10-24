import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AxiosError } from 'axios';
import { DatabaseService } from '../../database/database.service';
import { SharePointGraphClient } from './adapters/sharepoint-graph-client';
import type { SharePointIntegrationConfig, SharePointProjectSiteConfig } from './adapters/sharepoint-integration-config.types';
import type { ConnectSharePointDto } from './dto/connect-sharepoint.dto';
import type { MapSharePointProjectSiteDto } from './dto/map-sharepoint-project-site.dto';

export interface SharePointIntegrationStatus {
  connected: boolean;
  isActive: boolean;
  tenantId?: string;
  projectSites: Record<string, SharePointProjectSiteConfig>;
  lastAttemptedSyncAt?: string;
  lastSuccessfulSyncAt?: string;
  lastSyncError?: string;
}

interface DocIntegrationRow {
  config: SharePointIntegrationConfig;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastAttemptedSyncAt: string | null;
  lastSyncError: string | null;
}

// Company-admin-facing config for the SharePoint adapter (gated by
// @Roles('company_admin') on the controller, same mechanism as every
// other company-wide admin action in this app -- see ApiKeysController's
// own comment). Writes exactly the doc_integrations.config shape
// SiteDrawingSharePointAdapter reads (sharepoint-integration-config.types.ts),
// and nothing else -- this service owns the admin-facing side of that one
// row, the adapter owns the read (and its own deltaLink writes) side.
//
// There is no per-company secret to store for this provider -- see
// SharePointGraphClient's own header comment -- so, unlike
// AiConnectionsService/EmailTokenStore, there is no CredentialEncryptionService
// dependency here: the only thing genuinely confidential about this
// config is the tenant ID itself, and that's an identifier a company's own
// admin already knows, not a secret this app is trusted to keep.
@Injectable()
export class SharePointIntegrationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly graph: SharePointGraphClient,
  ) {}

  async getStatus(companyId: string): Promise<SharePointIntegrationStatus> {
    const [row] = await this.db.withTenant(companyId, sql => sql<DocIntegrationRow[]>`
      SELECT config, is_active, last_synced_at, last_attempted_sync_at, last_sync_error
      FROM doc_integrations WHERE company_id = ${companyId} AND system = 'sharepoint'
    `);
    if (!row) return { connected: false, isActive: false, projectSites: {} };
    return {
      connected: true,
      isActive: row.isActive,
      tenantId: row.config.tenantId,
      projectSites: row.config.projectSites ?? {},
      lastAttemptedSyncAt: row.lastAttemptedSyncAt ?? undefined,
      lastSuccessfulSyncAt: row.lastSyncedAt ?? undefined,
      lastSyncError: row.lastSyncError ?? undefined,
    };
  }

  // Validates the tenant ID against Microsoft BEFORE saving it -- same
  // "never save a connection that was never tested" rule
  // AiConnectionsService.connect() follows for a BYO AI provider. A
  // successful token request only confirms the tenant exists and
  // recognizes this app's registration (see SharePointGraphClient.
  // verifyTenant's own comment on what it does NOT confirm); reconnecting
  // with a new tenantId preserves any project site mappings already saved
  // under the old one would be wrong across a genuine tenant change, so a
  // caller switching tenants should disconnect and reconnect, re-mapping
  // projects fresh -- this method does not clear projectSites itself
  // since the common case (re-saving the SAME tenant after a transient
  // failure) must not lose them.
  async connect(companyId: string, dto: ConnectSharePointDto): Promise<SharePointIntegrationStatus> {
    try {
      await this.graph.verifyTenant(dto.tenantId);
    } catch (err) {
      throw new BadRequestException(`Could not verify this tenant with Microsoft: ${this.describeGraphError(err)}`);
    }

    await this.db.withTenant(companyId, (sql) => {
      const defaultConfig = sql.json({ tenantId: dto.tenantId, projectSites: {} });
      return sql`
        INSERT INTO doc_integrations (company_id, system, config, is_active)
        VALUES (${companyId}, 'sharepoint', ${defaultConfig}, true)
        ON CONFLICT (company_id, system) DO UPDATE SET
          config = jsonb_set(doc_integrations.config, '{tenantId}', to_jsonb(${dto.tenantId}::text)),
          is_active = true
      `;
    });
    return this.getStatus(companyId);
  }

  // Deactivates rather than deletes -- the tenant ID and every project's
  // site mapping stay saved (brief section 6's own "track last successful
  // vs. last attempted sync separately" spirit extends naturally to "don't
  // make an admin re-enter every project mapping after a brief
  // disconnect"). getSourceHealth() already reports unreachable for an
  // inactive connection, and every adapter read requires is_active = true.
  async disconnect(companyId: string): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      UPDATE doc_integrations SET is_active = false WHERE company_id = ${companyId} AND system = 'sharepoint'
    `);
  }

  async mapProjectSite(companyId: string, projectId: string, dto: MapSharePointProjectSiteDto): Promise<SharePointIntegrationStatus> {
    await this.assertProjectBelongsToCompany(companyId, projectId);
    const config = await this.requireConnection(companyId);

    try {
      const root = await this.graph.get(config.tenantId, `/drives/${dto.driveId}/root?$select=id`);
      if (!root) throw new BadRequestException('Could not reach that SharePoint drive: it was not found (check the drive ID).');
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Could not reach that SharePoint drive: ${this.describeGraphError(err)}`);
    }

    const siteConfig = this.buildSiteConfig(dto);
    await this.db.withTenant(companyId, (sql) => {
      // sql.json()'s JSONValue type requires an index signature a plain
      // interface can't structurally satisfy -- same boundary
      // TenancyService.updateSettings() already documents for the same
      // reason.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const siteConfigJson = sql.json(siteConfig as any);
      return sql`
        UPDATE doc_integrations
        SET config = jsonb_set(config, ARRAY['projectSites', ${projectId}], ${siteConfigJson})
        WHERE company_id = ${companyId} AND system = 'sharepoint'
      `;
    });
    return this.getStatus(companyId);
  }

  async unmapProjectSite(companyId: string, projectId: string): Promise<void> {
    await this.requireConnection(companyId);
    await this.db.withTenant(companyId, sql => sql`
      UPDATE doc_integrations
      SET config = config #- ARRAY['projectSites', ${projectId}]
      WHERE company_id = ${companyId} AND system = 'sharepoint'
    `);
  }

  private buildSiteConfig(dto: MapSharePointProjectSiteDto): SharePointProjectSiteConfig {
    const config: SharePointProjectSiteConfig = { siteId: dto.siteId, driveId: dto.driveId };
    if (dto.folderPath) config.folderPath = dto.folderPath;
    if (dto.drawingNumberField) config.drawingNumberField = dto.drawingNumberField;
    if (dto.drawingTitleField) config.drawingTitleField = dto.drawingTitleField;
    if (dto.disciplineField) config.disciplineField = dto.disciplineField;
    if (dto.buildingOrZoneField) config.buildingOrZoneField = dto.buildingOrZoneField;
    if (dto.floorOrLevelField) config.floorOrLevelField = dto.floorOrLevelField;
    if (dto.revisionNumberField) config.revisionNumberField = dto.revisionNumberField;
    if (dto.statusField) config.statusField = dto.statusField;
    if (dto.issueDateField) config.issueDateField = dto.issueDateField;
    return config;
  }

  private async requireConnection(companyId: string): Promise<SharePointIntegrationConfig> {
    const [row] = await this.db.withTenant(companyId, sql => sql<{ config: SharePointIntegrationConfig }[]>`
      SELECT config FROM doc_integrations WHERE company_id = ${companyId} AND system = 'sharepoint' AND is_active = true
    `);
    if (!row) throw new BadRequestException('Connect SharePoint for this company before mapping a project to a site.');
    return row.config;
  }

  private async assertProjectBelongsToCompany(companyId: string, projectId: string): Promise<void> {
    const [project] = await this.db.withTenant(companyId, sql => sql`
      SELECT id FROM projects WHERE id = ${projectId} AND company_id = ${companyId}
    `);
    if (!project) throw new NotFoundException(`Project ${projectId} not found.`);
  }

  private describeGraphError(err: unknown): string {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      if (status === 400 || status === 401) return 'the tenant ID was not recognized, or this app has not been granted access there yet.';
      if (status === 403) return 'access was denied -- the Sites.Selected permission may not be granted for this site yet.';
      if (status === 404) return 'the site or drive could not be found.';
      return `the request failed (HTTP ${status ?? 'unknown'}).`;
    }
    return err instanceof Error ? err.message : 'an unknown error occurred.';
  }
}
