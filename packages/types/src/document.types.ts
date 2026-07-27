export type DocType = 'drawing' | 'specification' | 'rfi' | 'submittal' | 'transmittal' | 'inspection_record' | 'method_statement' | 'risk_assessment' | 'handover_certificate' | 'test_report' | 'ncrm' | 'other';
export type DocSource = 'internal' | 'procore' | 'aconex' | 'sharepoint' | 'bim360' | 'manual_link';

export interface Document {
  id: string;
  companyId: string;
  projectId: string;
  docType: DocType;
  title: string;
  documentNumber?: string;
  revision?: string;
  status?: string;
  discipline?: string;
  source: DocSource;
  externalId?: string;
  externalUrl?: string;
  storageKey?: string;
  documentDate?: string;
  receivedDate?: string;
  dueDate?: string;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}
