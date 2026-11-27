import { IsArray, ArrayNotEmpty, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { SITE_DRAWING_WORKFLOW_STATUSES, type SiteDrawingWorkflowStatus } from '@engineeringos/types';

// Batch counterpart to SetSiteDrawingWorkflowStatusDto: the same
// document-control decision (gated behind the 'approve' category action),
// applied to every drawing in `ids` at once instead of one at a time.
export class BulkSetSiteDrawingWorkflowStatusDto {
  @IsArray() @ArrayNotEmpty() @IsUUID('4', { each: true })
  ids: string[];

  @IsIn(SITE_DRAWING_WORKFLOW_STATUSES)
  workflowStatus!: SiteDrawingWorkflowStatus;

  @IsOptional() @IsString()
  reason?: string;
}
