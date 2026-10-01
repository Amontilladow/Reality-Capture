import { IsIn, IsOptional, IsString } from 'class-validator';
import type { RiskStatus } from '@engineeringos/types';

const RISK_STATUSES: RiskStatus[] = [
  'DETECTED', 'ACTIVE', 'MITIGATION_IN_PROGRESS', 'MONITORING', 'ACCEPTED', 'ESCALATED', 'RESOLVED', 'CLOSED',
];

export class SetRiskStatusDto {
  @IsIn(RISK_STATUSES)
  status: RiskStatus;

  @IsOptional() @IsString()
  reason?: string;
}
