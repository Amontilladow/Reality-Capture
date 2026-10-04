import { IsString, IsNotEmpty, IsOptional, IsInt, IsUUID, MaxLength, Min, Max } from 'class-validator';

// No fixed enum: bim_elements.construction_status is a free-text VARCHAR(50)
// with no DB CHECK constraint. Validated as a non-empty string within the
// column's own length instead of guessing at an enum that could reject a
// legitimate future value. The frontend's own canonical set (F2) is
// 'not_started' | 'in_progress' | 'complete' | 'defective'.
export class UpdateElementStatusDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  status: string;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  completionPct?: number;

  // The capture/photo evidencing this status change -- optional (a status
  // can be set from the office without a fresh photo), recorded on the
  // bim_element_status_history row alongside from/to status.
  @IsOptional() @IsUUID()
  captureId?: string;
}
