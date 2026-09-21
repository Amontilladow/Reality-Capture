import { IsIn, IsString, MinLength, ValidateIf } from 'class-validator';

// Body for POST :id/decide-review. `comment` is required when rejecting
// (mirrors RequestClarificationDto.reason being required) -- a review
// rejection is modeled as the reviewer's own form of "send it back for
// clarification" (see RfisService.decideReview()), and that action has
// always required a reason. Optional on approval -- there's nothing to
// explain when simply signing off.
export class DecideReviewDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @ValidateIf((o: DecideReviewDto) => o.decision === 'rejected')
  @IsString() @MinLength(1)
  comment?: string;
}
