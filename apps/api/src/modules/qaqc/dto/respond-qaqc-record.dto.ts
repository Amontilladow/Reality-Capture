import { IsString, MinLength } from 'class-validator';

// Body for POST :id/respond -- moves 'open'/'reopened' -> 'pending_confirmation'.
// This is step 1 of the two-step close: whoever responds (construction_manager/
// project_manager/technical_director/engineering_manager, or admin) believes
// the record is resolved, but it isn't truly closed until QAQC-in-charge
// confirms it (see ConfirmQaqcRecordDto) -- structurally the RFI
// submitForReview()/decideReview() shape, with the roles swapped.
export class RespondQaqcRecordDto {
  @IsString() @MinLength(1)
  response: string;
}
