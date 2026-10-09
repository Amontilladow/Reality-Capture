import { IsString, MinLength } from 'class-validator';

// Mirrors AddRfiAttachmentDto's step-2-of-presigned-PUT shape: the client
// already PUT the file straight to storage and is handing back the key plus
// the metadata needed to re-validate and attach it, not the file content.
export class SendEmailAttachmentDto {
  @IsString() @MinLength(1) storageKey: string;
  @IsString() @MinLength(1) filename: string;
  @IsString() @MinLength(1) contentType: string;
}
