import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';

export class AddCaptureToIssueDto {
  @IsUUID()
  captureId: string;

  @IsOptional() @IsBoolean()
  isPrimary?: boolean;

  @IsOptional() @IsString()
  caption?: string;
}
