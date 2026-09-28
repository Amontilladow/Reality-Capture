import { IsString, IsOptional, IsNumber, IsUUID, MinLength, MaxLength } from 'class-validator';

export class UpdateLocationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255)
  name?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsNumber()
  posXNorm?: number;

  @IsOptional() @IsNumber()
  posYNorm?: number;

  // Nullable (not just optional) -- the UI clears a pin's element link by
  // sending elementId: null, distinct from omitting the field entirely.
  // @IsOptional() skips validation for both undefined and null, so a real
  // string is still checked as a UUID.
  @IsOptional() @IsUUID()
  elementId?: string | null;
}
