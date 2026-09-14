import { IsOptional, IsString, MaxLength } from 'class-validator';

export class HeartbeatDeviceDto {
  @IsOptional() @IsString() @MaxLength(50)
  agentVersion?: string;
}
