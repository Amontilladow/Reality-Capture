import type { Project, Building, Level, Location, PaginationQuery, ProjectPhase } from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost, apiPatch, apiDelete } from './api';

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
}

export function createProject(payload: CreateProjectPayload) {
  return apiPost<Project>('/projects', payload);
}

export function updateProject(id: string, payload: Partial<CreateProjectPayload> & { status?: string; phase?: ProjectPhase }) {
  return apiPatch<Project>(`/projects/${id}`, payload);
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

export interface ProjectMember {
  userId: string;
  projectId: string;
  projectRole: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export function getMembers(projectId: string) {
  return apiGet<ProjectMember[]>(`/projects/${projectId}/members`);
}

export function addMember(projectId: string, payload: { userId: string; projectRole: string }) {
  return apiPost<ProjectMember>(`/projects/${projectId}/members`, payload);
}

export function removeMember(projectId: string, userId: string) {
  return apiDelete<void>(`/projects/${projectId}/members/${userId}`);
}
