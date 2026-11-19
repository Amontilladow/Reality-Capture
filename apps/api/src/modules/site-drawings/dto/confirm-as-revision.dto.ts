import { IsNotEmpty, IsString } from 'class-validator';

// The human's explicit confirmation for a pending revision: "yes, this is
// genuinely a new revision of the drawing it's already linked to" (Site
// Drawing Hub integrity hardening, Phase 1/2). reviewNotes is required for
// the same reason ResolveReviewDto already requires it on every
// resolution -- a one-line record of why a human made this call, not just
// that they clicked a button.
export class ConfirmAsRevisionDto {
  @IsString() @IsNotEmpty()
  reviewNotes!: string;
}
