import { IsString, IsOptional, IsUUID, IsDateString, IsNumber, IsArray, MinLength, MaxLength, IsIn } from 'class-validator';

export class CreateIssueDto {
  @IsIn(['defect','punch_item','rfi','coordination_clash','safety_observation','quality_hold','inspection_point','general'])
  issueType: string;

  @IsString() @MinLength(3) @MaxLength(500)
  title: string;

  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsIn(['critical','high','medium','low']) priority?: string;
  @IsOptional() @IsString()  discipline?: string;
  @IsOptional() @IsString()  trade?: string;
  @IsOptional() @IsString()  specificationRef?: string;
  @IsOptional() @IsUUID()    buildingId?: string;
  @IsOptional() @IsUUID()    levelId?: string;
  @IsOptional() @IsUUID()    locationId?: string;
  @IsOptional() @IsUUID()    elementId?: string;
  @IsOptional() @IsUUID()    assignedTo?: string;
  @IsOptional() @IsString()  responsibleCompany?: string;
  @IsOptional() @IsDateString() deadline?: string;
  @IsOptional() @IsUUID()    captureId?: string;
  @IsOptional() @IsUUID()    drawingId?: string;
  @IsOptional() @IsNumber()  posXNorm?: number;
  @IsOptional() @IsNumber()  posYNorm?: number;
  @IsOptional() @IsNumber()  hotspotYaw?: number;
  @IsOptional() @IsNumber()  hotspotPitch?: number;
  @IsOptional() @IsArray()   tags?: string[];
}