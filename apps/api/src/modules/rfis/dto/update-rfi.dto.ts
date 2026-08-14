import { IsString, IsOptional, IsUUID, IsDateString, IsBoolean, MaxLength, IsIn } from 'class-validator';
import { RFI_DISCIPLINES, type RfiDiscipline } from '@engineeringos/types';

export class UpdateRfiDto {
  @IsOptional() @IsString() @MaxLength(500) subject?: string;
  @IsOptional() @IsString() question?: string;
  @IsOptional() @IsString() answer?: string;
  @IsOptional() @IsIn(['open', 'answered', 'closed', 'void']) status?: string;
  @IsOptional() @IsIn(['critical', 'high', 'medium', 'low']) priority?: string;
  @IsOptional() @IsIn(RFI_DISCIPLINES) discipline?: RfiDiscipline;
  @IsOptional() @IsString() disciplineOther?: string;
  @IsOptional() @IsBoolean() costImpact?: boolean;
  @IsOptional() @IsBoolean() timeImpact?: boolean;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
