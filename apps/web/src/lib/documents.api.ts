import axios from 'axios';
import type { Document, DocType, DocSource, PaginationQuery } from '@engineeringos/types';
import { apiGet, apiGetWithMeta, apiPost } from './api';

export function listDocuments(projectId: string, query?: PaginationQuery & { docType?: string; discipline?: string }) {
  return apiGetWithMeta<Document[]>(`/projects/${projectId}/documents`, { params: query });
}

export function getDocument(projectId: string, documentId: string) {
  return apiGet<Document & { downloadUrl?: string; links: unknown[] }>(`/projects/${projectId}/documents/${documentId}`);
}

export interface CreateDocumentPayload {
  docType: DocType;
  title: string;
  documentNumber?: string;
  revision?: string;
  status?: string;
  discipline?: string;
  source?: DocSource;
  externalId?: string;
  externalUrl?: string;
  storageKey?: string;
  documentDate?: string;
  receivedDate?: string;
  dueDate?: string;
}

export function createDocument(projectId: string, payload: CreateDocumentPayload) {
  return apiPost<Document>(`/projects/${projectId}/documents`, payload);
}

export function getDocumentUploadUrl(projectId: string, filename: string, contentType?: string) {
  return apiPost<{ uploadUrl: string; storageKey: string }>(`/projects/${projectId}/documents/upload-url`, { filename, contentType });
}

export async function uploadDocumentFile(
  projectId: string,
  file: File,
  meta: Omit<CreateDocumentPayload, 'storageKey' | 'source'>,
): Promise<Document> {
  // The same content type must be sent to both calls -- the upload-url call
  // signs it into the presigned PUT (see StorageService.getUploadUrl()'s
  // ContentType), so the PUT below has to send back exactly what was signed
  // or the request fails/mismatches. A hardcoded 'application/pdf' fallback
  // here previously meant every upload signed as a PDF regardless of the
  // real file type -- fine for actual PDFs, silently wrong for report-
  // attachment photos/images.
  const contentType = file.type || 'application/octet-stream';
  const { uploadUrl, storageKey } = await getDocumentUploadUrl(projectId, file.name, contentType);
  await axios.put(uploadUrl, file, { headers: { 'Content-Type': contentType } });
  return createDocument(projectId, { ...meta, storageKey, source: 'internal' });
}
