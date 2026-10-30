import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

export class GetEvacPlanUploadUrlDto {
  @IsString() @IsNotEmpty()
  filename!: string;

  // 'drawing' = a 2D evacuation-plan PDF; 'logo' = the PNG/JPG placed on every sheet.
  @IsIn(['drawing', 'logo'])
  kind!: 'drawing' | 'logo';
}

export class EvacPlanSourceFileDto {
  @IsString() @IsNotEmpty()
  storageKey!: string;

  @IsString() @IsNotEmpty()
  filename!: string;
}

export class CreateEvacPlanJobDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40)
  @ValidateNested({ each: true }) @Type(() => EvacPlanSourceFileDto)
  files!: EvacPlanSourceFileDto[];

  @IsOptional() @IsString()
  logoStorageKey?: string;

  // Reuse the logo of an earlier conversion in this project instead of uploading it again.
  @IsOptional() @IsUUID()
  reuseLogoFromJobId?: string;

  @IsOptional() @IsObject()
  settings?: { revision?: string; notes?: string[] };
}
