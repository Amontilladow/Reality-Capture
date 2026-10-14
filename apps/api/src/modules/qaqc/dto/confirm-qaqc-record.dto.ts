import { IsIn, IsString, MinLength, ValidateIf } from 'class-validator';

// Body for POST :id/confirm -- step 2 of the two-step close, QAQC-in-charge
// only. 'confirmed' moves 'pending_confirmation' -> 'closed' (confirmedBy/
// confirmedAt set). 'rejected' moves it -> 'reopened' and requires a
// comment, mirroring RFI's DecideReviewDto (a rejection is "send it back
// for clarification" and has always required a reason).
export class ConfirmQaqcRecordDto {
  @IsIn(['confirmed', 'rejected'])
  decision: 'confirmed' | 'rejected';

  @ValidateIf((o: ConfirmQaqcRecordDto) => o.decision === 'rejected')
  @IsString() @MinLength(1)
  comment?: string;
}
