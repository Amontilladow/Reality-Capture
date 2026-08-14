import { IsString, IsNumber, IsPositive } from 'class-validator';

export class RfiAttachmentUploadUrlDto {
  @IsString() filename: string;
  @IsNumber() @IsPositive() sizeBytes: number;
}
