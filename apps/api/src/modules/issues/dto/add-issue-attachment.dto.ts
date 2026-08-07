import { IsString, IsNumber, IsPositive, IsOptional } from 'class-validator';

// Step 2 of the presigned-PUT flow (see issues.controller.ts's
// attachments/upload-url + attachments endpoints): the client already PUT
// the file straight to storage using the storageKey from step 1, and is
// now registering it as an issue_activities row.
export class AddIssueAttachmentDto {
  @IsString() storageKey: string;
  @IsString() filename: string;
  @IsNumber() @IsPositive() sizeBytes: number;
  @IsOptional() @IsString() comment?: string;
}
