import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class GetDocumentUploadUrlDto {
  @IsString() @MinLength(1) @MaxLength(255)
  filename: string;

  @IsOptional() @IsString() @MaxLength(255)
  contentType?: string;
}
