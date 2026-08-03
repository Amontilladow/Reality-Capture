export type SubmittalStatus = 'submitted' | 'under_review' | 'approved' | 'approved_as_noted' | 'revise_and_resubmit' | 'rejected' | 'void';
export type SubmittalPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Submittal {
  id: string;
  companyId: string;
  projectId: string;
  submittalNumber?: string;
  title: string;
  specSection?: string;
  description?: string;
  status: SubmittalStatus;
  priority: SubmittalPriority;
  discipline?: string;
  revision?: string;
  assignedTo?: string;
  dueDate?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewComments?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
