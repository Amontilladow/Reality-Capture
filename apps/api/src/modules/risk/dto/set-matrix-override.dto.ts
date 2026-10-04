import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RISK_MATRIX_LEVELS, type RiskMatrixLevel } from '@engineeringos/types';

export class SetMatrixOverrideDto {
  @IsIn(['ACCEPT_AI', 'KEEP_HUMAN', 'CUSTOM'])
  decision: 'ACCEPT_AI' | 'KEEP_HUMAN' | 'CUSTOM';

  @IsOptional() @IsInt() @Min(1) @Max(25)
  score?: number;

  @IsOptional() @IsIn(RISK_MATRIX_LEVELS)
  level?: RiskMatrixLevel;

  @IsOptional() @IsString()
  reason?: string;
}
