import { IsString, IsOptional, IsArray, IsUUID, IsDateString } from 'class-validator';

export class UpdateCaptureDto {
  @IsOptional() @IsString()  title?: string;
  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsString()  phase?: string;
  @IsOptional() @IsArray()   tags?: string[];
  @IsOptional() @IsUUID()    locationId?: string;
  // Manual override for when a capture's actual on-site date differs from
  // when it was uploaded/processed (e.g. backfilling an older 360° photo) --
  // BuildLens's timeline sorts/labels captures by this field, so getting it
  // right matters more there than it did before this existed.
  @IsOptional() @IsDateString() capturedAt?: string;
}