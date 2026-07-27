import { IsString, IsOptional, IsUUID, IsIn } from 'class-validator';

export class AddActivityDto {
  @IsIn(['comment','status_change','capture_added','assigned','closed'])
  activityType: string;

  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() fromValue?: string;
  @IsOptional() @IsString() toValue?: string;
  @IsOptional() @IsUUID()   captureId?: string;
}