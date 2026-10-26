import { IsNotEmpty, IsObject, IsString } from 'class-validator';
import { GIS_PREP_PROFILES, type GisPrepProfile } from '@engineeringos/types';

export class GetGisPrepUploadUrlDto {
  @IsString() @IsNotEmpty()
  filename!: string;
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
