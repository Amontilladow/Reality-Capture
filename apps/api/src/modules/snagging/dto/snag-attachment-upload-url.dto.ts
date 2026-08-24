import { IsString, IsNumber, IsPositive } from 'class-validator';

export class SnagAttachmentUploadUrlDto {
  @IsString() filename: string;
  @IsNumber() @IsPositive() sizeBytes: number;
}
