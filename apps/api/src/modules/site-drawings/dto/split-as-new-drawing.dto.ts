import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// The human's explicit correction for a pending revision reconcile() could
// not confidently attach to the drawing it matched by number alone (Site
// Drawing Hub integrity hardening, Phase 1): "this is really a different
// drawing." drawingNumber/drawingTitle are REQUIRED, not optional like
// ResolveReviewDto's -- the whole point of this action is that extraction
// could not establish a trustworthy identity on its own, so a human must
// supply the real one, never inherit the original (also-uncertain) values.
export class SplitAsNewDrawingDto {
  @IsString() @IsNotEmpty()
  drawingNumber!: string;

  @IsString() @IsNotEmpty()
  drawingTitle!: string;

  @IsOptional() @IsString() @IsNotEmpty()
  revisionNumber?: string;

  @IsString() @IsNotEmpty()
  reviewNotes!: string;
}
