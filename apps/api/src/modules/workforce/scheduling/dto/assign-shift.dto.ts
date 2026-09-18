import { IsDateString, IsString, IsUUID, Matches } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:MM, 24-hour

export class AssignShiftDto {
  @IsUUID()
  userId: string;

  @IsDateString()
  shiftDate: string;

  @IsString() @Matches(TIME_PATTERN, { message: 'startTime must be HH:MM (24-hour)' })
  startTime: string;

  @IsString() @Matches(TIME_PATTERN, { message: 'endTime must be HH:MM (24-hour)' })
  endTime: string;
}
