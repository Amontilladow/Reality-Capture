import { IsString, IsNumber, IsPositive } from 'class-validator';

// Step 1 of the presigned-PUT flow -- same shape as RfiAttachmentUploadUrlDto.
export class QaqcAttachmentUploadUrlDto {
  @IsString() filename: string;
  @IsNumber() @IsPositive() sizeBytes: number;
}
