import { IsIn } from 'class-validator';

// All 9 issue_status_enum values -- unlike UpdateIssueDto's status field,
// this path (admin-only, gated by @Roles at the controller) bypasses
// whatever transition rules a normal status update might someday enforce.
export class ForceStatusDto {
  @IsIn(['open','assigned','in_progress','resolved','under_review','closed','void',
    'waiting_for_information','reopened'])
  status: string;
}
