import { IsString, IsOptional, IsUUID, IsDateString, MaxLength, IsIn } from 'class-validator';

export class UpdateRfiDto {
  @IsOptional() @IsString() @MaxLength(500) subject?: string;
  @IsOptional() @IsString() question?: string;
  @IsOptional() @IsString() answer?: string;
  @IsOptional() @IsIn(['open', 'answered', 'closed', 'void']) status?: string;
  @IsOptional() @IsIn(['critical', 'high', 'medium', 'low']) priority?: string;
  @IsOptional() @IsString() discipline?: string;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
