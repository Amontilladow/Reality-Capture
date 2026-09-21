import type { ProjectOrganizationSlot, RfiExternalAccess, RfiExternalAccessAction, RfiExternalDetail } from '@engineeringos/types';
import { apiGet, apiPost, apiDelete } from './api';

// Internal, authenticated side -- same manage_rfis gate as respond/close/reopen.
// `http` (used by apiGet/apiPost/apiDelete under the hood) only attaches a
// bearer token when one exists in the auth store, so these same helpers work
// fine for the public/unauthenticated calls below too -- no separate client.

export interface GenerateExternalAccessPayload {
  organizationSlot: ProjectOrganizationSlot;
  action: RfiExternalAccessAction;
  recipientEmail: string;
  recipientName?: string;
  expiresInDays?: number;
}

export function generateRfiExternalAccess(projectId: string, rfiId: string, payload: GenerateExternalAccessPayload) {
  return apiPost<RfiExternalAccess & { externalUrl: string }>(
    `/projects/${projectId}/rfis/${rfiId}/external-access`,
    payload,
  );
}

export function listRfiExternalAccess(projectId: string, rfiId: string) {
  return apiGet<RfiExternalAccess[]>(`/projects/${projectId}/rfis/${rfiId}/external-access`);
}

export function revokeRfiExternalAccess(projectId: string, rfiId: string, accessId: string) {
  return apiDelete<{ message: string }>(`/projects/${projectId}/rfis/${rfiId}/external-access/${accessId}`);
}

// ── Public, unauthenticated side (the /rfi/external/:token page) ──────────
// Distinct base path from the internal routes above -- see
// rfi-external-access.controller.ts's own comment on why.

export function getRfiExternalDetail(token: string) {
  return apiGet<RfiExternalDetail>(`/public/rfis/external/${token}`);
}

export function respondRfiExternal(token: string, answer: string) {
  return apiPost<{ id: string; status: string }>(`/public/rfis/external/${token}/respond`, { answer });
}

export function reviewRfiExternal(token: string, payload: { decision: 'approved' | 'rejected'; comment?: string }) {
  return apiPost<{ id: string; status: string }>(`/public/rfis/external/${token}/review`, payload);
}

export function commentRfiExternal(token: string, body: string) {
  return apiPost<{ id: string }>(`/public/rfis/external/${token}/comments`, { body });
}
