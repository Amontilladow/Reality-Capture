import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// An authorized user correcting or confirming a flagged extraction
// (brief section 3: "allow authorized users to correct metadata";
// Decision 1: "the system must support manual correction and
// validation"). Every field is optional except reviewNotes -- a reviewer
// might only need to confirm the extraction was actually fine (no
// corrections needed), or might only need to fix one field.
export class ResolveReviewDto {
  @IsOptional() @IsString() @IsNotEmpty()
  drawingNumber?: string;

  @IsOptional() @IsString() @IsNotEmpty()
  drawingTitle?: string;

  @IsOptional() @IsString() @IsNotEmpty()
  revisionNumber?: string;

  @IsString() @IsNotEmpty()
  reviewNotes!: string;

  // Always 'CONFIRMED' once a human has looked at it -- never left as
  // NEEDS_REVIEW/CONFLICT after a resolution action, and never silently
  // reset to MANUAL (that would misrepresent this as never having been
  // extracted at all).
  @IsIn(['CONFIRMED'])
  extractionStatus!: 'CONFIRMED';
}
