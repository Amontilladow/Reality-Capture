import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

// No fixed enum: bim_elements.construction_status is a free-text VARCHAR(50)
// with no DB CHECK constraint, and this endpoint currently has no frontend
// caller to confirm a canonical value set against. Validated as a
// non-empty string within the column's own length instead of guessing at
// an enum that could reject a legitimate future value.
export class UpdateElementStatusDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  status: string;
}
