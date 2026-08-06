export type TransmittalStatus = 'draft' | 'sent' | 'acknowledged' | 'void';
export type TransmittalPurpose = 'for_review' | 'for_approval' | 'for_record' | 'for_construction' | 'as_requested';

export interface Transmittal {
  id: string;
  companyId: string;
  projectId: string;
  transmittalNumber?: string;
  subject: string;
  recipientName: string;
  recipientCompany?: string;
  purpose: TransmittalPurpose;
  items: string;
  notes?: string;
  status: TransmittalStatus;
  sentDate?: string;
  dueDate?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
