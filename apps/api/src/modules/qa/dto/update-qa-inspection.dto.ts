import { IsString, IsOptional, IsUUID, IsDateString, MaxLength, IsIn } from 'class-validator';

export class UpdateQaInspectionDto {
  @IsOptional() @IsString() @MaxLength(500) title?: string;
  @IsOptional() @IsString() inspectionType?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() checklist?: string;
  @IsOptional() @IsString() findings?: string;
  @IsOptional() @IsIn(['scheduled', 'in_progress', 'passed', 'passed_with_exceptions', 'failed', 'void']) status?: string;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() inspectionDate?: string;
}
