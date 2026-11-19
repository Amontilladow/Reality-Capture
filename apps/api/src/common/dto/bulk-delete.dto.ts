import { IsArray, ArrayNotEmpty, IsUUID } from 'class-validator';

// Shared by every module's bulk-delete route (captures, rfis, qaqc, qa,
// issues, submittals, transmittals, snagging, risk, site-drawings): a flat
// list of record ids to remove from one project, scoped to that project
// by the controller's own :projectId param, not by anything in this body.
export class BulkDeleteDto {
  @IsArray() @ArrayNotEmpty() @IsUUID('4', { each: true })
  ids: string[];
}
