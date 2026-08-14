import { IsString, IsNumber, IsPositive, IsOptional, IsIn, ValidateIf } from 'class-validator';
import { RFI_DOCUMENT_TYPES, type RfiAttachmentKind, type RfiDocumentType } from '@engineeringos/types';

// Step 2 of the presigned-PUT flow (see rfis.controller.ts's
// attachments/upload-url + attachments endpoints): the client already PUT
// the file straight to storage using the storageKey from step 1, and is
// now registering it as an rfi_attachments row.
export class AddRfiAttachmentDto {
  @IsString() storageKey: string;
  @IsString() filename: string;
  @IsNumber() @IsPositive() sizeBytes: number;

  // Defaults to 'query' at the DB level (see migration 028) if omitted --
  // existing callers that don't know about kinds yet keep working unchanged.
  @IsOptional() @IsIn(['query', 'response', 'comment'])
  kind?: RfiAttachmentKind;

  @IsOptional() @IsIn(RFI_DOCUMENT_TYPES)
  documentType?: RfiDocumentType;

  @ValidateIf((dto: AddRfiAttachmentDto) => dto.documentType === 'other')
  @IsString()
  documentTypeOther?: string;

  @IsOptional() @IsString() revision?: string;
  @IsOptional() @IsString() description?: string;

  // Only meaningful when kind === 'comment' -- links the attachment to the
  // rfi_comments row it was uploaded alongside (see rfi_attachments.comment_id).
  @IsOptional() @IsString() commentId?: string;
}
