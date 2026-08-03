export type RfiStatus = 'open' | 'answered' | 'closed' | 'void';
export type RfiPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Rfi {
  id: string;
  companyId: string;
  projectId: string;
  rfiNumber?: string;
  subject: string;
  question: string;
  answer?: string;
  status: RfiStatus;
  priority: RfiPriority;
  discipline?: string;
  assignedTo?: string;
  dueDate?: string;
  answeredAt?: string;
  answeredBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
