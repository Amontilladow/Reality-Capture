import { IsString, IsOptional, IsUUID, IsIn } from 'class-validator';

export class AddActivityDto {
  // Extended additively for ticket 2b's workflow actions (forward,
  // admin-force-status, reopen, reminders, auto-warning) which this
  // ticket (2a) does not implement -- the values are added here now
  // purely so 2b doesn't need another DTO change. Note there is no DB
  // enum/CHECK constraint backing issue_activities.activity_type (it's
  // plain VARCHAR(50)); this @IsIn list is the actual "enum".
  @IsIn(['comment','status_change','capture_added','assigned','closed',
    'forward','reopened','auto_warning','manual_warning','status_force','reminder'])
  activityType: string;

  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() fromValue?: string;
  @IsOptional() @IsString() toValue?: string;
  @IsOptional() @IsUUID()   captureId?: string;
}