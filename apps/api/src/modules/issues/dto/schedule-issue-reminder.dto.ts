import { IsDateString, IsString, MinLength } from 'class-validator';

export class ScheduleIssueReminderDto {
  @IsDateString() scheduledFor: string;
  @IsString() @MinLength(1) message: string;
}
