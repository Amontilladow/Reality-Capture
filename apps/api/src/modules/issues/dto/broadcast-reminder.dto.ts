import { IsString, MinLength } from 'class-validator';

export class BroadcastReminderDto {
  @IsString() @MinLength(1)
  message: string;
}
