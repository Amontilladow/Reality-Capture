import { IsString, IsOptional, IsUUID, IsDateString, MinLength, MaxLength, IsIn } from 'class-validator';

export class CreateSnagItemDto {
  @IsString() @MinLength(3) @MaxLength(500)
  title: string;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() trade?: string;
  @IsOptional() @IsIn(['critical', 'high', 'medium', 'low']) priority?: string;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
