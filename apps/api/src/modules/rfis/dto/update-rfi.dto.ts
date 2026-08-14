import { IsString, IsOptional, IsUUID, IsDateString, IsBoolean, IsNumber, MaxLength, IsIn } from 'class-validator';
import { RFI_DISCIPLINES, RFI_IMPACT_LEVELS, type RfiDiscipline, type RfiImpactLevel } from '@engineeringos/types';

export class UpdateRfiDto {
  @IsOptional() @IsString() @MaxLength(500) subject?: string;
  @IsOptional() @IsString() question?: string;
  @IsOptional() @IsString() answer?: string;
  // Unchanged -- this is the legacy update path (see rfis.service.ts
  // update()). The new workflow statuses are only reachable through the
  // dedicated submit/request-clarification/respond/close/reopen endpoints.
  @IsOptional() @IsIn(['open', 'answered', 'closed', 'void']) status?: string;
  @IsOptional() @IsIn(['critical', 'high', 'medium', 'low']) priority?: string;
  @IsOptional() @IsIn(RFI_DISCIPLINES) discipline?: RfiDiscipline;
  @IsOptional() @IsString() disciplineOther?: string;

  // Legacy boolean shape -- unchanged, kept for backward compatibility.
  @IsOptional() @IsBoolean() costImpact?: boolean;
  @IsOptional() @IsBoolean() timeImpact?: boolean;

  // New 4-state shape (Phase 1) -- see CreateRfiDto for the same fields.
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
