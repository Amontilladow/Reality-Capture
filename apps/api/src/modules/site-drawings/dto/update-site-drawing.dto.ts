import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Manual correction of an already-registered drawing's identity fields --
// the gap ResolveReviewDto's own flow doesn't cover: a mistake discovered
// well after import, with nothing left pending in the Review Queue (the
// extractor had already confidently, but wrongly, filled these in; see
// the "4 drawings collapsed into one PR-169 register entry" report that
// prompted this route). Every field is optional; the caller sends only
// what's actually wrong. revisionNumber corrects the drawing's CURRENT
// revision only -- there is no "the" revision number stored on
// site_drawings itself, and a superseded revision's own number is edited
// through its own history entry, not through this route.
export class UpdateSiteDrawingDto {
  @IsOptional() @IsString() @IsNotEmpty()
  drawingNumber?: string;

  @IsOptional() @IsString() @IsNotEmpty()
  drawingTitle?: string;

  @IsOptional() @IsString() @IsNotEmpty()
  revisionNumber?: string;
}
