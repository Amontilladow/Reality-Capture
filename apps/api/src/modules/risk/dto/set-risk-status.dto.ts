import { IsIn, IsOptional, IsString } from 'class-validator';

export class SetRiskStatusDto {
  @IsIn(['DETECTED', 'ACTIVE', 'MITIGATION_IN_PROGRESS', 'RESOLVED', 'CLOSED'])
  status: 'DETECTED' | 'ACTIVE' | 'MITIGATION_IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

  @IsOptional() @IsString()
  reason?: string;
}
