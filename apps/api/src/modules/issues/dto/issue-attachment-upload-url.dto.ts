import { IsString, IsNumber, IsPositive } from 'class-validator';

export class IssueAttachmentUploadUrlDto {
  @IsString() filename: string;
  @IsNumber() @IsPositive() sizeBytes: number;
}
