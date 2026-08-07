export type SnagStatus = 'open' | 'fixed' | 'verified' | 'void';
export type SnagPriority = 'critical' | 'high' | 'medium' | 'low';

export interface SnagItem {
  id: string;
  companyId: string;
  projectId: string;
  snagNumber?: string;
  title: string;
  description?: string;
  location?: string;
  trade?: string;
  priority: SnagPriority;
  status: SnagStatus;
  assignedTo?: string;
  dueDate?: string;
  fixedAt?: string;
  fixedBy?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
