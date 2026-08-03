import { IsString, IsOptional, IsUUID, IsDateString, MinLength, MaxLength, IsIn } from 'class-validator';

export class CreateRfiDto {
  @IsString() @MinLength(3) @MaxLength(500)
  subject: string;

  @IsString() @MinLength(3)
  question: string;

  @IsOptional() @IsIn(['critical', 'high', 'medium', 'low']) priority?: string;
  @IsOptional() @IsString() discipline?: string;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
