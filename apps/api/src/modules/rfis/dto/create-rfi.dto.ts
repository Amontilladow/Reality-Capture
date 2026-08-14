import { IsString, IsOptional, IsUUID, IsDateString, IsBoolean, IsNumber, MinLength, MaxLength, IsIn, ValidateIf } from 'class-validator';
import { RFI_DISCIPLINES, RFI_IMPACT_LEVELS, type RfiDiscipline, type RfiImpactLevel } from '@engineeringos/types';

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

  // Legacy boolean shape -- unchanged, kept for backward compatibility with
  // the current (unmodified in Phase 1) frontend.
  @IsOptional() @IsBoolean() costImpact?: boolean;
  @IsOptional() @IsBoolean() timeImpact?: boolean;

  // New 4-state shape (Phase 1). All optional -- when omitted, the service
  // derives the level from the legacy boolean; when both are omitted,
  // defaults as today ('no'/false).
  @IsOptional() @IsIn(RFI_IMPACT_LEVELS) costImpactLevel?: RfiImpactLevel;
  @IsOptional() @IsNumber() costImpactAmount?: number;
  @IsOptional() @IsString() @MaxLength(10) costImpactCurrency?: string;
  @IsOptional() @IsString() costImpactDescription?: string;

  @IsOptional() @IsIn(RFI_IMPACT_LEVELS) timeImpactLevel?: RfiImpactLevel;
  @IsOptional() @IsNumber() timeImpactDays?: number;
  @IsOptional() @IsString() timeImpactDescription?: string;

  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
