import { IsString, IsOptional, IsIn, IsUUID } from 'class-validator';

// Links an already-uploaded Capture (the "+Add photo" quick picker's
// upload) to a QAQC record -- mirrors AddCaptureToIssueDto one-for-one.
// kind splits issue-time photos from response-time photos, same as
// AddQaqcAttachmentDto.kind.
export class AddQaqcCaptureDto {
  @IsUUID()
  captureId: string;

  @IsOptional() @IsIn(['issue', 'response'])
  kind?: 'issue' | 'response';

  @IsOptional() @IsString()
  caption?: string;
}
