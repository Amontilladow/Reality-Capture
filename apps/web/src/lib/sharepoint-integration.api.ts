import { apiDelete, apiGet, apiPut } from './api';

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
}

export interface SharePointIntegrationStatus {
  connected: boolean;
  isActive: boolean;
  tenantId?: string;
  projectSites: Record<string, SharePointProjectSiteConfig>;
  lastAttemptedSyncAt?: string;
  lastSuccessfulSyncAt?: string;
  lastSyncError?: string;
}

const base = '/site-drawings/sharepoint-integration';

export const getSharePointStatus = () => apiGet<SharePointIntegrationStatus>(base);

export const connectSharePoint = (tenantId: string) => apiPut<SharePointIntegrationStatus>(base, { tenantId });

export const disconnectSharePoint = () => apiDelete<{ disconnected: boolean }>(base);

export const mapSharePointProjectSite = (projectId: string, input: SharePointProjectSiteConfig) =>
  apiPut<SharePointIntegrationStatus>(`${base}/projects/${projectId}`, input);

export const unmapSharePointProjectSite = (projectId: string) =>
  apiDelete<{ removed: boolean }>(`${base}/projects/${projectId}`);
