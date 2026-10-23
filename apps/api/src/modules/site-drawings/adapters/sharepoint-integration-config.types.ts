// The doc_integrations.config JSONB shape for system = 'sharepoint' --
// shared by SiteDrawingSharePointAdapter (reads it) and
// SharePointIntegrationService (the admin-facing service that writes it),
// so the two can never drift apart on what a field means.
//
// Everything here is non-secret -- see sharepoint-graph-client.ts's own
// header comment on why there is no per-company client secret to store for
// this provider.
export interface SharePointProjectSiteConfig {
  siteId: string;
  driveId: string;
  folderPath?: string;
  drawingNumberField?: string;
  drawingTitleField?: string;
  disciplineField?: string;
  buildingOrZoneField?: string;
  floorOrLevelField?: string;
  revisionNumberField?: string;
  statusField?: string;
  issueDateField?: string;
  // Delta-query resume token -- written by the adapter's own
  // checkForChanges(), never by the admin config service.
  deltaLink?: string;
}

export interface SharePointIntegrationConfig {
  tenantId: string;
  projectSites: Record<string, SharePointProjectSiteConfig>;
}
