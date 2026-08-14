import { IsString, IsNumber, IsPositive } from 'class-validator';

// Step 2 of the presigned-PUT flow (see rfis.controller.ts's
// attachments/upload-url + attachments endpoints): the client already PUT
// the file straight to storage using the storageKey from step 1, and is
// now registering it as an rfi_attachments row.
export class AddRfiAttachmentDto {
  @IsString() storageKey: string;
  @IsString() filename: string;
  @IsNumber() @IsPositive() sizeBytes: number;
}
