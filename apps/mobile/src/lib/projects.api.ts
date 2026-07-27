import type { Project, Building, Level, Location, PaginationQuery } from '@engineeringos/types';
import { apiGet, apiGetWithMeta } from './api';

export function listProjects(query?: PaginationQuery) {
  return apiGetWithMeta<Project[]>('/projects', { params: query });
}

export function getProject(id: string) {
  return apiGet<Project>(`/projects/${id}`);
}

export interface ProjectHierarchy extends Building {
  levels: (Level & { locations: Location[] })[];
}

export function getHierarchy(projectId: string) {
  return apiGet<ProjectHierarchy[]>(`/projects/${projectId}/hierarchy`);
}
