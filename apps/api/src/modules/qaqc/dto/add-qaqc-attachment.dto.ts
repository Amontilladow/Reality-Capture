import { IsString, IsNumber, IsPositive, IsOptional, IsIn } from 'class-validator';

// Step 2 of the presigned-PUT flow -- registers an already-uploaded file as
// a qaqc_attachments row. kind defaults to 'issue' at the DB level
// (migration 067) -- the QAQC-in-charge's own attachments when first
// raising the record; 'response' is set explicitly by whoever closes it
// (construction_manager/technical_director/qa_qc_manager/admin), mirroring
// RFI's 'query'/'response' kind split one-for-one.
export class AddQaqcAttachmentDto {
  @IsString() storageKey: string;
  @IsString() filename: string;
  @IsNumber() @IsPositive() sizeBytes: number;

  @IsOptional() @IsIn(['issue', 'response'])
  kind?: 'issue' | 'response';
}
