import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RISK_DRIVERS, type RiskDriver } from '@engineeringos/types';

export class SetHumanAssessmentDto {
  @IsInt() @Min(1) @Max(5)
  probability: number;

  @IsInt() @Min(1) @Max(5)
  impact: number;

  @IsIn(RISK_DRIVERS)
  primaryDriver: RiskDriver;

  @IsOptional() @IsIn(RISK_DRIVERS)
  secondaryDriver?: RiskDriver;
}
