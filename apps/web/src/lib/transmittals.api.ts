import type { Transmittal, TransmittalStatus, TransmittalPurpose } from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost, apiPatch, apiDelete } from './api';

export interface TransmittalListItem extends Transmittal {
  createdByName?: string;
}

export interface TransmittalSummary {
  total: number;
  draft: number;
  sent: number;
  acknowledged: number;
}

export interface TransmittalFilters {
  status?: string;
  purpose?: string;
  page?: number;
  perPage?: number;
}

export function listTransmittals(projectId: string, filters?: TransmittalFilters) {
  return apiGetWithMeta<TransmittalListItem[]>(`/projects/${projectId}/transmittals`, { params: filters });
}

export function getTransmittalSummary(projectId: string) {
  return apiGet<TransmittalSummary>(`/projects/${projectId}/transmittals/summary`);
}

export function getTransmittal(projectId: string, transmittalId: string) {
  return apiGet<TransmittalListItem>(`/projects/${projectId}/transmittals/${transmittalId}`);
}

export interface CreateTransmittalPayload {
  subject: string;
  recipientName: string;
  recipientCompany?: string;
  purpose?: TransmittalPurpose;
  items: string;
  notes?: string;
  dueDate?: string;
}

export function createTransmittal(projectId: string, payload: CreateTransmittalPayload) {
  return apiPost<Transmittal>(`/projects/${projectId}/transmittals`, payload);
}

export interface UpdateTransmittalPayload {
  subject?: string;
  recipientName?: string;
  recipientCompany?: string;
  purpose?: TransmittalPurpose;
  items?: string;
  notes?: string;
  status?: TransmittalStatus;
  dueDate?: string;
}

export function updateTransmittal(projectId: string, transmittalId: string, payload: UpdateTransmittalPayload) {
  return apiPatch<Transmittal>(`/projects/${projectId}/transmittals/${transmittalId}`, payload);
}

export function deleteTransmittal(projectId: string, transmittalId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/transmittals/${transmittalId}`);
}
