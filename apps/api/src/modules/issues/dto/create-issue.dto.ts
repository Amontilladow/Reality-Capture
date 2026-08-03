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

  // View state captured from the BIM viewer at the moment "Raise issue" was
  // clicked, so "view in 3D" can restore the exact vantage point instead of
  // only re-selecting the linked element. All optional -- an issue raised
  // outside the viewer (or before this feature existed) simply has none of
  // these set.
  @IsOptional() @IsUUID()   modelId?: string;
  @IsOptional() @IsNumber() cameraPosX?: number;
  @IsOptional() @IsNumber() cameraPosY?: number;
  @IsOptional() @IsNumber() cameraPosZ?: number;
  @IsOptional() @IsNumber() cameraTargetX?: number;
  @IsOptional() @IsNumber() cameraTargetY?: number;
  @IsOptional() @IsNumber() cameraTargetZ?: number;
  @IsOptional() @IsString() screenshotStorageKey?: string;
}