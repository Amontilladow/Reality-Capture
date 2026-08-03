import { IsString, IsOptional, IsUUID, IsDateString, MinLength, MaxLength, IsIn } from 'class-validator';

export class CreateSubmittalDto {
  @IsString() @MinLength(3) @MaxLength(500)
  title: string;

  @IsOptional() @IsString() specSection?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(['critical', 'high', 'medium', 'low']) priority?: string;
  @IsOptional() @IsString() discipline?: string;
  @IsOptional() @IsString() revision?: string;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
