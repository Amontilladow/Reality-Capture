export interface AuditLogEntry {
  id: number;
  companyId: string;
  projectId?: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceLabel?: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  source: 'api' | 'mobile' | 'system' | 'import';
  checksum?: string;
  occurredAt: string;
}
