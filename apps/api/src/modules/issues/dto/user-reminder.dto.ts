import { IsString, IsUUID, MinLength } from 'class-validator';

export class UserReminderDto {
  @IsUUID() userId: string;
  @IsString() @MinLength(1) message: string;
}
