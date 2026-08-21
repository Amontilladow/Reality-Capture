import axios from 'axios';
import type { Project, Building, Level, Location, PaginationQuery, ProjectPhase, ProjectOrganizationSlot } from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost, apiPatch, apiPut, apiDelete } from './api';

export function listProjects(query?: PaginationQuery) {
  return apiGetWithMeta<Project[]>('/projects', { params: query });
}

export function getProject(id: string) {
  return apiGet<Project>(`/projects/${id}`);
}

export interface CreateProjectPayload {
  name: string;
  code?: string;
  description?: string;
  location?: string;
  country?: string;
  city?: string;
  startDate?: string;
  expectedEndDate?: string;
  orgCode?: string;
  clientName?: string;
  leadDesigner?: string;
  consultantName?: string;
  technicalAdvisor?: string;
  pmcName?: string;
  mainContractor?: string;
  subcontractor?: string;
}

export function createProject(payload: CreateProjectPayload) {
  return apiPost<Project>('/projects', payload);
}

export function updateProject(
  id: string,
  payload: Partial<CreateProjectPayload> & { status?: string; phase?: ProjectPhase; logoStorageKey?: string; stampStorageKey?: string },
) {
  return apiPatch<Project>(`/projects/${id}`, payload);
}

// ── Branding (logo/stamp, presigned-PUT) ───────────────────────────────────
export function getBrandingUploadUrl(projectId: string, filename: string, sizeBytes: number, kind: 'logo' | 'stamp') {
  return apiPost<{ uploadUrl: string; storageKey: string }>(
    `/projects/${projectId}/branding/upload-url`,
    { filename, sizeBytes, kind },
  );
}

// Full client-side flow: request the presigned URL, PUT the file straight
// to storage, then save the resulting key on the project (reusing the
// normal update path -- no separate "register" endpoint for branding).
export async function uploadProjectBranding(projectId: string, file: File, kind: 'logo' | 'stamp'): Promise<Project> {
  const { uploadUrl, storageKey } = await getBrandingUploadUrl(projectId, file.name, file.size, kind);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  return updateProject(projectId, kind === 'logo' ? { logoStorageKey: storageKey } : { stampStorageKey: storageKey });
}

export interface ProjectHierarchy extends Building {
  levels: (Level & { locations: Location[] })[];
}

export function getHierarchy(projectId: string) {
  return apiGet<ProjectHierarchy[]>(`/projects/${projectId}/hierarchy`);
}

export function createBuilding(projectId: string, payload: { name: string; code?: string; totalLevels?: number }) {
  return apiPost<Building>(`/projects/${projectId}/buildings`, payload);
}

export function updateBuilding(projectId: string, buildingId: string, payload: { name?: string; phase?: ProjectPhase }) {
  return apiPatch<Building>(`/projects/${projectId}/buildings/${buildingId}`, payload);
}

export function createLevel(
  projectId: string,
  buildingId: string,
  payload: { name: string; elevationM?: number; levelOrder: number },
) {
  return apiPost<Level>(`/projects/${projectId}/buildings/${buildingId}/levels`, payload);
}

export function createLocation(
  projectId: string,
  buildingId: string,
  levelId: string,
  payload: { name: string; description?: string },
) {
  return apiPost<Location>(`/projects/${projectId}/buildings/${buildingId}/levels/${levelId}/locations`, payload);
}

export function updateLocation(
  projectId: string,
  locationId: string,
  payload: { name?: string; description?: string; posXNorm?: number; posYNorm?: number; elementId?: string | null },
) {
  return apiPatch<Location>(`/projects/${projectId}/locations/${locationId}`, payload);
}

export function archiveLocation(projectId: string, locationId: string) {
  return apiDelete<Location>(`/projects/${projectId}/locations/${locationId}`);
}

export function convertPinToSnag(projectId: string, locationId: string) {
  return apiPost<{ id: string; snagNumber?: string }>(`/projects/${projectId}/locations/${locationId}/convert-to-snag`, {});
}

// ── Project organizations (Phase 4) ────────────────────────────────────────
// One row per configured stakeholder slot -- an unconfigured slot simply
// isn't in this list (see projects.service.ts's getOrganizations()).
export interface ProjectOrganization {
  id: string;
  projectId: string;
  companyId: string;
  slot: ProjectOrganizationSlot;
  name?: string;
  orgRef?: string;
  contactName?: string;
  contactEmail?: string;
  logoStorageKey?: string;
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export function getOrganizations(projectId: string) {
  return apiGet<ProjectOrganization[]>(`/projects/${projectId}/organizations`);
}

export interface UpsertOrganizationPayload {
  name?: string;
  orgRef?: string;
  contactName?: string;
  contactEmail?: string;
  logoStorageKey?: string;
}

export function upsertOrganization(projectId: string, slot: ProjectOrganizationSlot, data: UpsertOrganizationPayload) {
  return apiPut<ProjectOrganization>(`/projects/${projectId}/organizations/${slot}`, data);
}

export function getOrganizationLogoUploadUrl(projectId: string, slot: ProjectOrganizationSlot, filename: string, sizeBytes: number) {
  return apiPost<{ uploadUrl: string; storageKey: string }>(
    `/projects/${projectId}/organizations/${slot}/logo-upload-url`,
    { filename, sizeBytes },
  );
}

// Full client-side flow, same shape as uploadProjectBranding() above:
// request the presigned URL, PUT the file straight to storage, then save
// the resulting key on the organization row (reusing the normal upsert
// path -- no separate "register" endpoint).
export async function uploadOrganizationLogo(projectId: string, slot: ProjectOrganizationSlot, file: File): Promise<ProjectOrganization> {
  const { uploadUrl, storageKey } = await getOrganizationLogoUploadUrl(projectId, slot, file.name, file.size);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  return upsertOrganization(projectId, slot, { logoStorageKey: storageKey });
}

export interface ProjectMember {
  userId: string;
  // Actual field name returned by GET /projects/:id/members -- was
  // incorrectly declared as `projectRole` here, which silently rendered as
  // undefined everywhere this type was used (both the Team modal's member
  // list and the Issues form's assignee dropdown showed no role at all).
  role: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export function getMembers(projectId: string) {
  return apiGet<ProjectMember[]>(`/projects/${projectId}/members`);
}

export function addMember(projectId: string, payload: { userId: string; role: string }) {
  return apiPost<ProjectMember>(`/projects/${projectId}/members`, payload);
}

export function removeMember(projectId: string, userId: string) {
  return apiDelete<void>(`/projects/${projectId}/members/${userId}`);
}

export interface PermissionGrant {
  id: string;
  permission: string;
  grantedAt: string;
  userId: string;
  firstName?: string;
  lastName?: string;
  email: string;
  grantedByFirstName?: string;
  grantedByLastName?: string;
}

export function getPermissionGrants(projectId: string) {
  return apiGet<PermissionGrant[]>(`/projects/${projectId}/permission-grants`);
}

export function grantPermission(projectId: string, payload: { userId: string; permission: string }) {
  return apiPost<PermissionGrant>(`/projects/${projectId}/permission-grants`, payload);
}

export function revokePermission(projectId: string, userId: string, permission: string) {
  return apiDelete<void>(`/projects/${projectId}/permission-grants/${userId}/${permission}`);
}
