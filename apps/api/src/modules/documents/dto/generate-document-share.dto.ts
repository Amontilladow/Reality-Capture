import { IsEmail, IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

export class GenerateDocumentShareDto {
  @IsOptional() @IsEmail()
  recipientEmail?: string;

  @IsOptional() @IsString() @MaxLength(255)
  recipientName?: string;

  @IsOptional() @IsInt() @Min(1) @Max(90)
  expiresInDays?: number;
}
