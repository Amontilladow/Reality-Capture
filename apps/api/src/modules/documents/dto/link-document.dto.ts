import { IsUUID, IsOptional, IsString } from 'class-validator';

export class LinkDocumentDto {
  @IsOptional() @IsUUID() captureId?: string;
  @IsOptional() @IsUUID() elementId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() issueId?: string;
  @IsOptional() @IsString() linkContext?: string;
}