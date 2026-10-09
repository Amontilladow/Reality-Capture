import {
  IsArray, IsEmail, IsIn, IsOptional, IsString, IsUUID,
  ArrayMaxSize, ArrayMinSize, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { EmailProvider } from '@engineeringos/types';
import { SendEmailAttachmentDto } from './send-email-attachment.dto';

const EMAIL_RELATED_RECORD_TYPES = ['rfi', 'issue', 'snag_item', 'submittal'] as const;
export type EmailRelatedRecordType = typeof EMAIL_RELATED_RECORD_TYPES[number];

// The compose form's full field list (Section 6): From is implicit (the
// connected mailbox, resolved server-side from `provider`, never a field
// the client can set), To/CC/BCC/Subject/Message/Attachments/Related
// project (the :projectId route param, not a body field)/Related record.
export class SendEmailDto {
  @IsIn(['microsoft', 'google']) provider: EmailProvider;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  to: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  cc?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  bcc?: string[];

  @IsString() @MinLength(1) @MaxLength(255)
  subject: string;

  @IsString() @MinLength(1) @MaxLength(50_000)
  bodyText: string;

  @IsOptional() @IsArray() @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => SendEmailAttachmentDto)
  attachments?: SendEmailAttachmentDto[];

  // Explicit override for the brief's "auto-match by reference number"
  // design -- when the sender already knows which record this is about
  // (the common case: they clicked "Send Email" from an RFI's own page),
  // the composer passes it directly instead of leaving EmailComposerService
  // to guess from the subject text.
  @IsOptional() @IsIn(EMAIL_RELATED_RECORD_TYPES)
  relatedRecordType?: EmailRelatedRecordType;

  @IsOptional() @IsUUID()
  relatedRecordId?: string;

  // Client-generated once per compose-and-send attempt and resent unchanged
  // on a retry of that same attempt -- see email_messages' own UNIQUE
  // constraint comment (migration 066).
  @IsString() @MinLength(1) @MaxLength(100)
  idempotencyKey: string;
}
