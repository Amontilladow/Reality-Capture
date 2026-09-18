import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:MM, 24-hour

export class SetShiftPreferenceDto {
  @IsInt() @Min(0) @Max(6)
  dayOfWeek: number;

  @IsOptional() @IsBoolean()
  preferred?: boolean;

  @IsOptional() @IsString() @Matches(TIME_PATTERN, { message: 'startTime must be HH:MM (24-hour)' })
  startTime?: string;

  @IsOptional() @IsString() @Matches(TIME_PATTERN, { message: 'endTime must be HH:MM (24-hour)' })
  endTime?: string;
}
