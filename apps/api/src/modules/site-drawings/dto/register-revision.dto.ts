import { IsBoolean, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SITE_DRAWING_WORKFLOW_STATUSES, type SiteDrawingWorkflowStatus } from '@engineeringos/types';

export class RegisterSiteDrawingRevisionDto {
  @IsString() @IsNotEmpty()
  revisionNumber!: string;

  @IsIn(SITE_DRAWING_WORKFLOW_STATUSES)
  workflowStatus!: SiteDrawingWorkflowStatus;

  @IsOptional() @IsISO8601()
  issueDate?: string;

  @IsString() @IsNotEmpty()
  storageKey!: string;

  // Defaults true server-side when omitted -- see
  // SiteDrawingsService.addRevision()'s own comment on why false must be
  // explicit rather than implied by a missing field.
  @IsOptional() @IsBoolean()
  offlineEligibility?: boolean;
}
