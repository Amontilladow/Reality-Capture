import { IsString, IsOptional, IsUUID, IsDateString, IsBoolean, MinLength, MaxLength, IsIn, ValidateIf } from 'class-validator';
import { RFI_DISCIPLINES, type RfiDiscipline } from '@engineeringos/types';

export class CreateRfiDto {
  @IsString() @MinLength(3) @MaxLength(500)
  subject: string;

  @IsString() @MinLength(3)
  question: string;

  @IsOptional() @IsIn(['critical', 'high', 'medium', 'low']) priority?: string;

  // Required -- the numbering scheme (see rfis.service.ts generateRfiNumber)
  // needs a discipline code for every RFI.
  @IsIn(RFI_DISCIPLINES) discipline: RfiDiscipline;

  // Only meaningful (and required) when discipline === 'other'.
  @ValidateIf((dto: CreateRfiDto) => dto.discipline === 'other')
  @IsString() @MinLength(1)
  disciplineOther?: string;

  @IsOptional() @IsBoolean() costImpact?: boolean;
  @IsOptional() @IsBoolean() timeImpact?: boolean;

  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
