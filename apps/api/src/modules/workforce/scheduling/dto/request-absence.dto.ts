import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ABSENCE_TYPES } from '@engineeringos/types';

export class RequestAbsenceDto {
  @IsIn(ABSENCE_TYPES)
  absenceType: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}
