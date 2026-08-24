import { IsString, IsOptional, IsIn } from 'class-validator';

// Smaller set than issues' AddActivityDto -- snags don't have evidence
// captures or the auto-warning/reopened/assigned/closed activity types.
// No DB enum/CHECK constraint backs snag_activities.activity_type (plain
// VARCHAR(50)); this @IsIn list is the actual "enum".
export class AddSnagActivityDto {
  @IsIn(['comment','status_change','forward','status_force'])
  activityType: string;

  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() fromValue?: string;
  @IsOptional() @IsString() toValue?: string;
}
