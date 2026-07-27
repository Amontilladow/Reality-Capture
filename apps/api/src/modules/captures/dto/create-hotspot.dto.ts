import { IsString, IsNumber, IsOptional, IsUUID, IsIn } from 'class-validator';

export class CreateHotspotDto {
  @IsIn(['navigation', 'info', 'annotation', 'issue'])
  hotspotType: 'navigation' | 'info' | 'annotation' | 'issue';

  @IsNumber() yawDeg: number;
  @IsNumber() pitchDeg: number;

  @IsOptional() @IsString()  label?: string;
  @IsOptional() @IsString()  content?: string;
  @IsOptional() @IsUUID()    targetCaptureId?: string;
  @IsOptional() @IsString()  iconName?: string;
  @IsOptional() @IsString()  color?: string;
}