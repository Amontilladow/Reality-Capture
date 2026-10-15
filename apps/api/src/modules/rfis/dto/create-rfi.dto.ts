import { IsString, IsOptional, IsUUID, IsDateString, IsBoolean, IsNumber, MinLength, MaxLength, IsIn, ValidateIf } from 'class-validator';
import {
  RFI_DISCIPLINES, RFI_IMPACT_LEVELS, PROJECT_ORGANIZATION_SLOTS, RFI_ORIGINS,
  type RfiDiscipline, type RfiImpactLevel, type ProjectOrganizationSlot, type RfiOrigin,
} from '@engineeringos/types';

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

  // Third impact field, same 4-state vocabulary, no amount/currency-or-days
  // companion -- just level + description (see migration 044).
  @IsOptional() @IsIn(RFI_IMPACT_LEVELS) drawingImpactLevel?: RfiImpactLevel;
  @IsOptional() @IsString() drawingImpactDescription?: string;
  @IsOptional() @IsUUID() drawingUpdateOwnerId?: string;

  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() dueDate?: string;

  // Which organization is raising this RFI -- normal callers leave this
  // unset (server defaults to 'main_contractor'); the frontend's
  // Subcontractor's-RFIs window sends 'subcontractor' explicitly, but
  // RfisService.create() re-derives and overrides it server-side from the
  // caller's actual project role regardless of what's sent here, so a
  // subcontractor can never spoof 'main_contractor' and vice versa.
  @IsOptional() @IsIn(PROJECT_ORGANIZATION_SLOTS) raisedByOrganizationSlot?: ProjectOrganizationSlot;

  // Upload-RFI quick-create fields (a DC backfilling an RFI actually raised
  // and answered on Aconex/Procore/email) -- all optional, every normal
  // create() call omits them and gets the pre-existing behavior unchanged.
  @IsOptional() @IsIn(RFI_ORIGINS) origin?: RfiOrigin;
  @IsOptional() @IsString() @MaxLength(255) originReference?: string;
  @IsOptional() @IsIn(['open', 'answered', 'closed']) initialStatus?: 'open' | 'answered' | 'closed';
  @IsOptional() @IsString() answer?: string;
}
