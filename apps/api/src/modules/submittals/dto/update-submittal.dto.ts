import { IsString, IsOptional, IsUUID, IsDateString, MaxLength, IsIn } from 'class-validator';

export class UpdateSubmittalDto {
  @IsOptional() @IsString() @MaxLength(500) title?: string;
  @IsOptional() @IsString() specSection?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(['submitted', 'under_review', 'approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected', 'void']) status?: string;
  @IsOptional() @IsIn(['critical', 'high', 'medium', 'low']) priority?: string;
  @IsOptional() @IsString() discipline?: string;
  @IsOptional() @IsString() revision?: string;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() reviewComments?: string;
}
