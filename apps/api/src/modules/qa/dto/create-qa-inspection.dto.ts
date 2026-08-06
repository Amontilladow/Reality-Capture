import { IsString, IsOptional, IsUUID, IsDateString, MinLength, MaxLength } from 'class-validator';

export class CreateQaInspectionDto {
  @IsString() @MinLength(3) @MaxLength(500)
  title: string;

  @IsOptional() @IsString() inspectionType?: string;
  @IsOptional() @IsString() location?: string;

  @IsString() @MinLength(1)
  checklist: string;

  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() inspectionDate?: string;
}
