import { IsString, IsNumber, IsPositive, IsOptional, IsIn } from 'class-validator';
import { RFI_DOCUMENT_TYPES, type RfiDocumentType } from '@engineeringos/types';

// Step 2 of the presigned-PUT flow -- registers an already-uploaded file as
// a qaqc_attachments row. This is the generic "+Add document" path (method
// statements, test certificates, specs, etc.) -- distinct from the quick
// "+Add photo" picker, which uploads a real Capture and links it via
// qaqc_captures instead (see QaqcService.linkCapture()).
//
// kind defaults to 'issue' at the DB level (migration 067) -- the
// QAQC-in-charge's own attachments when first raising the record;
// 'response' is set explicitly by whoever responds to it (construction/
// PM/director/engineering), mirroring RFI's 'query'/'response' kind split
// one-for-one. documentType reuses RFI_DOCUMENT_TYPES wholesale.
export class AddQaqcAttachmentDto {
  @IsString() storageKey: string;
  @IsString() filename: string;
  @IsNumber() @IsPositive() sizeBytes: number;

  @IsOptional() @IsIn(['issue', 'response'])
  kind?: 'issue' | 'response';

  @IsOptional() @IsIn(RFI_DOCUMENT_TYPES)
  documentType?: RfiDocumentType;
}
