import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PRODUCTIVITY_CLASSIFICATIONS } from '@engineeringos/types';

export class CreateApplicationDto {
  @IsString() @MinLength(1) @MaxLength(255)
  name: string;

  // Executable name/pattern the agent matches against, e.g. "revit.exe".
  @IsString() @MinLength(1) @MaxLength(255)
  matchPattern: string;

  // Free text by design -- brief §11 requires a configurable registry,
  // not a hardcoded category taxonomy.
  @IsOptional() @IsString() @MaxLength(100)
  category?: string;

  @IsOptional() @IsString() @MaxLength(100)
  discipline?: string;

  @IsOptional() @IsIn(PRODUCTIVITY_CLASSIFICATIONS)
  productivityClassification?: string;

  @IsOptional() @IsBoolean()
  engineeringRelevance?: boolean;
}
