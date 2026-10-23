import { IsIn, IsOptional, IsString } from 'class-validator';
import { SITE_DRAWING_WORKFLOW_STATUSES, type SiteDrawingWorkflowStatus } from '@engineeringos/types';

// A document-control decision (e.g. marking a revision Approved for
// Construction, or Withdrawn) -- gated behind the 'approve' category action,
// stricter than the 'edit' action that governs ordinary metadata changes.
export class SetSiteDrawingWorkflowStatusDto {
  @IsIn(SITE_DRAWING_WORKFLOW_STATUSES)
  workflowStatus!: SiteDrawingWorkflowStatus;

  @IsOptional() @IsString()
  reason?: string;
}
