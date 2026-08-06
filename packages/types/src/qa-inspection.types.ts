export type QaInspectionStatus = 'scheduled' | 'in_progress' | 'passed' | 'passed_with_exceptions' | 'failed' | 'void';

export interface QaInspection {
  id: string;
  companyId: string;
  projectId: string;
  inspectionNumber?: string;
  title: string;
  inspectionType?: string;
  location?: string;
  checklist: string;
  findings?: string;
  status: QaInspectionStatus;
  assignedTo?: string;
  inspectionDate?: string;
  completedAt?: string;
  completedBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
