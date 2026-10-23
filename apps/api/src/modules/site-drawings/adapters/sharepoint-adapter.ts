import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import { DatabaseService } from '../../../database/database.service';
import { SharePointGraphClient } from './sharepoint-graph-client';
import type { DiscoveredDrawing, DrawingSourceAdapter, SourceHealthCheck } from './drawing-source-adapter.interface';

// Per-project mapping of a RealityCapture project onto one SharePoint
// document library (brief section 6: "evaluate Microsoft Graph
// authentication options... for SharePoint"). Column names are
// per-PROJECT, not hardcoded for every customer, because two projects on
// two different SharePoint sites legitimately use different document
// library schemas (brief section 4/5: "configurable, never one hardcoded
// taxonomy for every project").
//
// Everything here is non-secret (a tenant ID, a site/drive GUID, column
// names) -- it lives in doc_integrations.config as plain JSONB, same as
// every other provider's config. There is deliberately no secret stored
// per company for THIS provider: the credential that talks to Graph is
// this app's own single Entra app registration
// (MICROSOFT_OAUTH_CLIENT_ID/_SECRET), reused across every customer --
// see SharePointGraphClient's own header comment for why, and for the two
// admin-side Entra steps a customer's tenant admin must complete before
// any of this can reach their data.
interface SharePointProjectSiteConfig {
  siteId: string;
  driveId: string;
  // Scopes discovery to a subfolder of the drive's root, when the
  // drawing register doesn't live at the library root.
  folderPath?: string;
  // Optional column-name overrides. Unset ones fall back to a filename-
  // or version-based default (documented at each call site below) rather
  // than failing -- a project can start using this adapter with zero
  // configuration beyond the site/drive mapping itself.
  drawingNumberField?: string;
  drawingTitleField?: string;
  disciplineField?: string;
  buildingOrZoneField?: string;
  floorOrLevelField?: string;
  revisionNumberField?: string;
  statusField?: string;
  issueDateField?: string;
  // Delta-query resume token (brief section 6: "evaluate... delta sync
  // support for change detection") -- persisted back to doc_integrations
  // after each checkForChanges() call, so the next poll is incremental
  // rather than a full re-crawl.
  deltaLink?: string;
}

interface SharePointIntegrationConfig {
  tenantId: string;
  projectSites: Record<string, SharePointProjectSiteConfig>;
}

interface DriveItemFields {
  Title?: string;
  [key: string]: unknown;
}

interface DriveItem {
  id: string;
  name: string;
  webUrl: string;
  lastModifiedDateTime: string;
  size?: number;
  file?: { hashes?: Record<string, string> };
  listItem?: { fields?: DriveItemFields };
}

interface DriveChildrenPage {
  value: DriveItem[];
  '@odata.nextLink'?: string;
}

interface DriveItemVersion {
  id: string;
  lastModifiedDateTime: string;
}

const MAX_PAGES = 20; // see the module-level comment on listDrawings() for why this is a documented, not silent, limit
const PDF_EXTENSION = /\.pdf$/i;

// The first real external-source adapter (brief section 6 Phase 2). Built
// and unit-tested against mocked Graph responses (see
// sharepoint-adapter.spec.ts) -- it has NOT been exercised end-to-end
// against a real Microsoft 365 tenant, because this environment has
// neither a customer tenant ID nor the two admin-side Entra grants
// SharePointGraphClient's header comment describes. Per the brief's own
// "do not claim a provider integration works without real credentials and
// successful end-to-end tests" rule, this is reported as implemented and
// unit-tested, not as validated end-to-end.
@Injectable()
export class SiteDrawingSharePointAdapter implements DrawingSourceAdapter {
  private readonly logger = new Logger(SiteDrawingSharePointAdapter.name);
  readonly provider = 'sharepoint' as const;

  constructor(
    private readonly db: DatabaseService,
    private readonly graph: SharePointGraphClient,
  ) {}

  async listDrawings(companyId: string, projectId: string): Promise<DiscoveredDrawing[]> {
    const { tenantId, site } = await this.requireProjectSite(companyId, projectId);
    const items = await this.listAllChildren(tenantId, site);
    const drawings: DiscoveredDrawing[] = [];
    for (const item of items) {
      if (!PDF_EXTENSION.test(item.name)) continue; // matches this phase's PDF-only register, same as the local upload path
      drawings.push(await this.toDiscoveredDrawing(tenantId, site, item));
    }
    return drawings;
  }

  async getDrawingMetadata(companyId: string, projectId: string, sourceFileId: string): Promise<DiscoveredDrawing | null> {
    const { tenantId, site } = await this.requireProjectSite(companyId, projectId);
    const item = await this.graph.get<DriveItem>(tenantId, `/drives/${site.driveId}/items/${sourceFileId}?$select=id,name,webUrl,lastModifiedDateTime,size,file&$expand=listItem($expand=fields)`);
    if (!item) return null;
    return this.toDiscoveredDrawing(tenantId, site, item);
  }

  async getSourceHealth(companyId: string, projectId: string): Promise<SourceHealthCheck> {
    const config = await this.getConfig(companyId);
    if (!config) return { reachable: false, detail: 'SharePoint is not connected for this company.' };
    const site = config.projectSites[projectId];
    if (!site) return { reachable: false, detail: 'This project is not mapped to a SharePoint site yet.' };

    try {
      await this.graph.get(config.tenantId, `/drives/${site.driveId}/root?$select=id`);
      return { reachable: true, detail: undefined };
    } catch (err) {
      return { reachable: false, detail: this.describeGraphError(err) };
    }
  }

  // SharePoint's own version history on the ONE driveItem (brief section
  // 5: "Keep drawing and revision records logically separate" still
  // holds here -- the item is the drawing, each version is a revision).
  // revisionNumber is the version's own label ("1.0", "2.0", ...), which
  // SharePoint assigns itself and is real data, not an inference.
  async listRevisions(companyId: string, projectId: string, sourceFileId: string): Promise<DiscoveredDrawing[]> {
    const { tenantId, site } = await this.requireProjectSite(companyId, projectId);
    const item = await this.graph.get<DriveItem>(tenantId, `/drives/${site.driveId}/items/${sourceFileId}?$select=id,name,webUrl,lastModifiedDateTime,size,file&$expand=listItem($expand=fields)`);
    if (!item) return [];
    // The shared (non-revisionNumber) fields only -- each version below
    // supplies its OWN revisionNumber from its own version id, so there's
    // no need for toDiscoveredDrawing()'s revisionNumber-resolution path
    // (and the extra "latest version" Graph call it can make) here.
    const base = this.mapSharedFields(site, item);

    const versions = await this.graph.get<{ value: DriveItemVersion[] }>(tenantId, `/drives/${site.driveId}/items/${sourceFileId}/versions`);
    if (!versions?.value.length) return [{ ...base, revisionNumber: '1.0' }];

    return versions.value
      .sort((a, b) => new Date(b.lastModifiedDateTime).getTime() - new Date(a.lastModifiedDateTime).getTime())
      .map((v) => ({ ...base, revisionNumber: v.id, sourceRevisionId: v.id, sourceModifiedAt: v.lastModifiedDateTime }));
  }

  // Delta query (brief section 6) -- an incremental, resumable poll for
  // "has anything in this drive changed" rather than re-listing the whole
  // library on every check. The resume token is persisted back to
  // doc_integrations immediately, before the caller does anything with the
  // result, so a crash between the Graph call and the caller's own
  // processing doesn't lose the token and force a full re-crawl.
  async checkForChanges(companyId: string, projectId: string, _sinceIso: string): Promise<boolean> {
    const { tenantId, site } = await this.requireProjectSite(companyId, projectId);
    const path = site.deltaLink ?? `/drives/${site.driveId}/root/delta`;
    const page = await this.graph.get<{ value: DriveItem[]; '@odata.deltaLink'?: string; '@odata.nextLink'?: string }>(tenantId, path);
    if (!page) throw new Error('SharePoint delta query failed -- the stored delta link may have expired; a full resync is needed.');

    const nextDeltaLink = page['@odata.deltaLink'] ?? page['@odata.nextLink'];
    if (nextDeltaLink) await this.saveDeltaLink(companyId, projectId, nextDeltaLink);

    const relevant = page.value.filter((item) => PDF_EXTENSION.test(item.name));
    return relevant.length > 0;
  }

  // sourceRevisionId absent/undefined -> current version's own
  // downloadUrl; given -> that specific historical version's content URL
  // (see DrawingSourceAdapter's own comment on why these differ).
  async getAuthorizedFile(companyId: string, projectId: string, sourceFileId: string, sourceRevisionId?: string): Promise<{ url: string; expiresInSeconds: number }> {
    const { tenantId, site } = await this.requireProjectSite(companyId, projectId);
    const url = sourceRevisionId
      ? await this.graph.getVersionContentUrl(tenantId, site.driveId, sourceFileId, sourceRevisionId)
      : await this.graph.getCurrentDownloadUrl(tenantId, site.driveId, sourceFileId);
    if (!url) throw new BadRequestException('Could not resolve an authorized download URL from SharePoint for this file.');
    // Approximate, not Microsoft-guaranteed -- see SharePointGraphClient's
    // own comment on getCurrentDownloadUrl.
    return { url, expiresInSeconds: 3600 };
  }

  // ── Config + mapping helpers ─────────────────────────────────────────────

  private async getConfig(companyId: string): Promise<SharePointIntegrationConfig | null> {
    const [row] = await this.db.withTenant(companyId, sql => sql<{ config: SharePointIntegrationConfig }[]>`
      SELECT config FROM doc_integrations WHERE company_id = ${companyId} AND system = 'sharepoint' AND is_active = true
    `);
    return row?.config ?? null;
  }

  private async requireProjectSite(companyId: string, projectId: string): Promise<{ tenantId: string; site: SharePointProjectSiteConfig }> {
    const config = await this.getConfig(companyId);
    if (!config) throw new BadRequestException('SharePoint is not connected for this company.');
    const site = config.projectSites[projectId];
    if (!site) throw new BadRequestException(`Project ${projectId} is not mapped to a SharePoint site.`);
    return { tenantId: config.tenantId, site };
  }

  private async saveDeltaLink(companyId: string, projectId: string, deltaLink: string): Promise<void> {
    await this.db.withTenant(companyId, sql => sql`
      UPDATE doc_integrations
      SET config = jsonb_set(config, ARRAY['projectSites', ${projectId}, 'deltaLink'], to_jsonb(${deltaLink}::text))
      WHERE company_id = ${companyId} AND system = 'sharepoint'
    `);
  }

  // Pagination up to MAX_PAGES -- a documented limit, not a silent drop:
  // a library deep enough to exceed it logs a warning rather than quietly
  // returning a partial register. A real production sync job would make
  // this resumable (persist the nextLink the same way checkForChanges()
  // persists its delta link) rather than capping it; that's named as an
  // unresolved risk in this phase's own report, not pretended away here.
  private async listAllChildren(tenantId: string, site: SharePointProjectSiteConfig): Promise<DriveItem[]> {
    const basePath = site.folderPath
      ? `/drives/${site.driveId}/root:/${encodeURIComponent(site.folderPath)}:/children`
      : `/drives/${site.driveId}/root/children`;
    let path: string | null = `${basePath}?$select=id,name,webUrl,lastModifiedDateTime,size,file&$expand=listItem($expand=fields)&$top=200`;
    const items: DriveItem[] = [];
    for (let page = 0; path && page < MAX_PAGES; page += 1) {
      const result: DriveChildrenPage | null = await this.graph.get<DriveChildrenPage>(tenantId, path);
      if (!result) break;
      items.push(...result.value);
      path = result['@odata.nextLink'] ?? null;
    }
    if (path) this.logger.warn(`SharePoint listDrawings() hit the ${MAX_PAGES}-page cap for drive ${site.driveId} -- the register may be incomplete.`);
    return items;
  }

  // Current-state mapping (listDrawings/getDrawingMetadata): resolves
  // revisionNumber via the configured column or, failing that, one extra
  // call for the item's own latest version label (see latestVersionLabel's
  // own comment on why that's an acceptable cost here).
  private async toDiscoveredDrawing(tenantId: string, site: SharePointProjectSiteConfig, item: DriveItem): Promise<DiscoveredDrawing> {
    const base = this.mapSharedFields(site, item);
    const fields = item.listItem?.fields ?? {};
    const configured = this.readField(fields, site.revisionNumberField);
    return { ...base, revisionNumber: configured ?? await this.latestVersionLabel(tenantId, site.driveId, item.id) };
  }

  // Every field EXCEPT revisionNumber -- shared between the current-state
  // mapping above and listRevisions()'s per-version mapping, neither of
  // which needs to repeat this logic or (for listRevisions) make any extra
  // Graph call to fill it in, since each version supplies its own.
  private mapSharedFields(site: SharePointProjectSiteConfig, item: DriveItem): Omit<DiscoveredDrawing, 'revisionNumber'> {
    const fields = item.listItem?.fields ?? {};
    const nameWithoutExtension = item.name.replace(PDF_EXTENSION, '');
    const field = (name: string | undefined) => this.readField(fields, name);

    return {
      sourceFileId: item.id,
      sourceWebUrl: item.webUrl,
      drawingNumber: field(site.drawingNumberField) ?? nameWithoutExtension,
      drawingTitle: field(site.drawingTitleField) ?? nameWithoutExtension,
      discipline: field(site.disciplineField),
      buildingOrZone: field(site.buildingOrZoneField),
      floorOrLevel: field(site.floorOrLevelField),
      // Never inferred from the filename, modified date, or anything else
      // (brief section 5) -- left undefined unless a status column is
      // actually configured, which maps to 'UNKNOWN' downstream
      // (fallbackMapSourceStatus) and surfaces the required warning.
      sourceStatusRaw: field(site.statusField),
      issueDate: field(site.issueDateField),
      sourceModifiedAt: item.lastModifiedDateTime,
      fileSizeBytes: item.size,
      // Deliberately NOT populated from item.file.hashes (SharePoint's own
      // quickXorHash/sha1Hash) -- SiteDrawingRevision.contentHash is
      // compared against the WEB CLIENT's own SHA-256 of the downloaded
      // bytes (site-drawings-offline.ts's computeContentHash) the first
      // time a user downloads it for offline use. Seeding it here with a
      // different hash algorithm would make that comparison fail for
      // every SharePoint-sourced offline download.
    };
  }

  private readField(fields: DriveItemFields, name: string | undefined): string | undefined {
    if (!name) return undefined;
    const value = fields[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  // Real data (SharePoint's own version label), not a guess -- used as
  // listDrawings()'s default revisionNumber when no revisionNumberField is
  // configured for the project. One extra Graph call per item; acceptable
  // here since listDrawings() is a periodic sync-job operation, not a
  // live interactive list (see DrawingSourceAdapter's own comment).
  private async latestVersionLabel(tenantId: string, driveId: string, itemId: string): Promise<string> {
    const versions = await this.graph.get<{ value: DriveItemVersion[] }>(tenantId, `/drives/${driveId}/items/${itemId}/versions?$top=1`);
    return versions?.value[0]?.id ?? '1.0';
  }

  private describeGraphError(err: unknown): string {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        return 'SharePoint rejected this request -- the app registration may be missing Sites.Selected access to this site, or admin consent has not been granted.';
      }
      if (status === 404) return 'The configured SharePoint site or drive could not be found.';
      return `SharePoint request failed (HTTP ${status ?? 'unknown'}).`;
    }
    return err instanceof Error ? err.message : 'Unknown error contacting SharePoint.';
  }
}
