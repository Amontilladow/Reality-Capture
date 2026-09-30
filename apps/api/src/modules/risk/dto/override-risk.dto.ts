import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class OverrideRiskDto {
  @IsOptional() @IsInt() @Min(0) @Max(100)
  score?: number;

  @IsOptional() @IsIn(['LOW', 'MODERATE', 'HIGH', 'CRITICAL'])
  level?: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

  @IsString() @MinLength(3)
  reason: string;
}
