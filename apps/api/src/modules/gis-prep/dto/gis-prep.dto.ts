import { IsInt, IsNotEmpty, IsObject, IsOptional, IsPositive, IsString } from 'class-validator';
import { GIS_PREP_PROFILES, type GisPrepProfile } from '@engineeringos/types';

export class GetGisPrepUploadUrlDto {
  @IsString() @IsNotEmpty()
  filename!: string;

  // The browser's own File.size -- client-reported, so NEVER trusted as the
  // real enforcement (createJob()'s post-upload HEAD-based size check is
  // that), but checking it here rejects an obviously oversized file before
  // a presigned URL is even issued, instead of after the whole upload to
  // S3 completes only to be deleted.
  @IsOptional() @IsInt() @IsPositive()
  declaredSizeBytes?: number;
}

// settings is passed through to the GIS preparation service, whose own
// JobSettings model is the validator of record (it rejects anything it does
// not understand with a readable message, surfaced as the job's error).
export class CreateGisPrepJobDto {
  @IsString() @IsNotEmpty()
  storageKey!: string;

  @IsString() @IsNotEmpty()
  originalFilename!: string;

  @IsObject()
  settings!: Record<string, unknown> & { profile: GisPrepProfile };
}

export class RerunGisPrepJobDto {
  @IsObject()
  settings!: Record<string, unknown> & { profile: GisPrepProfile };
}

export function assertProfile(settings: { profile?: unknown }): GisPrepProfile | null {
  return GIS_PREP_PROFILES.includes(settings.profile as GisPrepProfile) ? (settings.profile as GisPrepProfile) : null;
}
