import { IsString, IsOptional, IsIn, MinLength, MaxLength } from 'class-validator';
import { PROJECT_PHASES } from '@engineeringos/types';

export class UpdateBuildingDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255)
  name?: string;

  // buildings.phase is a real Postgres enum (project_phase_enum) -- an
  // invalid value fails at the DB level today with an opaque 500. Validating
  // against the same PROJECT_PHASES list the rest of the app already uses
  // (see projects.api.ts) just turns that into a clean 400.
  @IsOptional() @IsIn(PROJECT_PHASES)
  phase?: string;
}
