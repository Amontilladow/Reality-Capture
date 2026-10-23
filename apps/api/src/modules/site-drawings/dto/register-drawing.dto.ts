import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SITE_DRAWING_WORKFLOW_STATUSES, type SiteDrawingWorkflowStatus } from '@engineeringos/types';

// Registers a brand-new drawing (and its first revision) from the Local
// source -- the uploader picks the canonical workflow status directly
// (section 5: never inferred from the filename/timestamp), since there is
// no external source status to map for an internal upload.
export class RegisterSiteDrawingDto {
  @IsString() @IsNotEmpty()
  drawingNumber!: string;

  @IsString() @IsNotEmpty()
  drawingTitle!: string;

  @IsOptional() @IsString()
  discipline?: string;

  @IsOptional() @IsString()
  buildingOrZone?: string;

  @IsOptional() @IsString()
  floorOrLevel?: string;

  @IsString() @IsNotEmpty()
  revisionNumber!: string;

  @IsIn(SITE_DRAWING_WORKFLOW_STATUSES)
  workflowStatus!: SiteDrawingWorkflowStatus;

  @IsOptional() @IsISO8601()
  issueDate?: string;

  @IsString() @IsNotEmpty()
  storageKey!: string;
}
