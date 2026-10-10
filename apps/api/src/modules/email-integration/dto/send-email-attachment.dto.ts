import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Mirrors AddRfiAttachmentDto's step-2-of-presigned-PUT shape: the client
// already PUT the file straight to storage and is handing back the key plus
// the metadata needed to re-validate and attach it, not the file content.
//
// filename/contentType reject CR/LF for the same reason SendEmailDto's
// subject does: GmailClient.buildMimeMessage() embeds both directly into
// raw MIME part headers (Content-Type/Content-Disposition), so an
// embedded line break would let either one smuggle in extra headers.
const NO_LINE_BREAKS = { message: 'Cannot contain line breaks.' };

export class SendEmailAttachmentDto {
  @IsString() @MinLength(1) @MaxLength(1024) storageKey: string;

  @IsString() @MinLength(1) @MaxLength(255)
  @Matches(/^[^\r\n]*$/, NO_LINE_BREAKS)
  filename: string;

  @IsString() @MinLength(1) @MaxLength(255)
  @Matches(/^[^\r\n]*$/, NO_LINE_BREAKS)
  contentType: string;
}
