import { IsIn, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { PROJECT_ORGANIZATION_SLOTS, type ProjectOrganizationSlot } from '@engineeringos/types';

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

  // Only meaningful when decision === 'approved' (that's the branch that
  // actually closes the RFI) -- captures which party is closing it. Stays
  // optional at the DTO level so a historical caller (or a reject) never
  // breaks; the frontend enforces "must pick one before closing" as a UX
  // guard, not a backend requirement.
  @IsOptional() @IsIn(PROJECT_ORGANIZATION_SLOTS)
  organizationSlot?: ProjectOrganizationSlot;
}
