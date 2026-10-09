import { IsNumber, IsPositive, IsString } from 'class-validator';

export class EmailAttachmentUploadUrlDto {
  @IsString() filename: string;
  @IsNumber() @IsPositive() sizeBytes: number;
}
