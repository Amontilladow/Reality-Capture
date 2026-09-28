import { IsString, IsOptional, IsUUID } from 'class-validator';

export class LinkCaptureToElementDto {
  @IsUUID()
  captureId: string;

  @IsOptional() @IsString()
  linkType?: string;
}
