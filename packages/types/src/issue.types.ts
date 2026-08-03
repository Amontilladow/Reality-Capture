import type { ProjectPhase } from './project.types';

export type IssueType = 'defect' | 'punch_item' | 'rfi' | 'coordination_clash' | 'safety_observation' | 'quality_hold' | 'inspection_point' | 'general';
export type IssuePriority = 'critical' | 'high' | 'medium' | 'low';
export type IssueStatus = 'open' | 'assigned' | 'in_progress' | 'resolved' | 'under_review' | 'closed' | 'void';

export interface Issue {
  id: string;
  companyId: string;
  projectId: string;
  buildingId?: string;
  levelId?: string;
  locationId?: string;
  elementId?: string;
  issueType: IssueType;
  issueNumber?: string;
  title: string;
  description?: string;
  priority: IssuePriority;
  discipline?: string;
  trade?: string;
  specificationRef?: string;
  status: IssueStatus;
  assignedTo?: string;
  responsibleCompany?: string;
  deadline?: string;
  closedAt?: string;
  closedBy?: string;
  captureId?: string;
  drawingId?: string;
  posXNorm?: number;
  posYNorm?: number;
  hotspotYaw?: number;
  hotspotPitch?: number;
  modelId?: string;
  cameraPosX?: number;
  cameraPosY?: number;
  cameraPosZ?: number;
  cameraTargetX?: number;
  cameraTargetY?: number;
  cameraTargetZ?: number;
  screenshotStorageKey?: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueActivity {
  id: string;
  issueId: string;
  companyId: string;
  activityType: 'comment' | 'status_change' | 'capture_added' | 'assigned' | 'closed';
  content?: string;
  fromValue?: string;
  toValue?: string;
  captureId?: string;
  performedBy: string;
  createdAt: string;
}
