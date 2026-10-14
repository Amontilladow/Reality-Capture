import { IsString, IsOptional, IsUUID, IsDateString, IsIn, MinLength, MaxLength, ValidateIf } from 'class-validator';
import { RFI_DISCIPLINES, type RfiDiscipline } from '@engineeringos/types';

// Field set deliberately mirrors CreateRfiDto's "subject/question(->description)/
// priority/discipline+disciplineOther/assignedTo/dueDate" shape (the brief's
// own "very similar RFI input criteria") -- RFI's cost/time/drawing-impact
// fields are RFI-specific and have no NCR/SOR equivalent; the quality-risk
// equivalent is priority feeding the Risk Engine (see risk.service.ts's
// RISK_WORTHY_NODE_TYPES), not a second scoring block on this record.
//
// recordType is required here (not inferred from the route) since one
// shared qaqc_records table serves both NCR and SOR -- see migration 067's
// own comment for why this is one table with a discriminator, not two.
export class CreateQaqcRecordDto {
  @IsIn(['ncr', 'sor']) recordType: 'ncr' | 'sor';

  @IsString() @MinLength(3) @MaxLength(500)
  subject: string;

  @IsString() @MinLength(3)
  description: string;

  @IsOptional() @IsIn(['critical', 'high', 'medium', 'low']) priority?: string;

  // Reuses RFI_DISCIPLINES wholesale -- no QAQC-specific discipline values
  // were needed (civil/structural/architectural/.../other already covers
  // what an NCR/SOR needs to classify).
  @IsIn(RFI_DISCIPLINES) discipline: RfiDiscipline;

  @ValidateIf((dto: CreateQaqcRecordDto) => dto.discipline === 'other')
  @IsString() @MinLength(1)
  disciplineOther?: string;

  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
