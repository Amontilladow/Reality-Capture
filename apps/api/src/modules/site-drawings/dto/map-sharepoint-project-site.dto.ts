import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Maps one RealityCapture project onto one SharePoint document library.
// The column-name fields are optional overrides (see
// SiteDrawingSharePointAdapter's own comment on the filename/version-label
// fallback each one has) -- a project can be mapped with just siteId +
// driveId and nothing else.
export class MapSharePointProjectSiteDto {
  @IsString() @IsNotEmpty()
  siteId!: string;

  @IsString() @IsNotEmpty()
  driveId!: string;

  @IsOptional() @IsString()
  folderPath?: string;

  @IsOptional() @IsString()
  drawingNumberField?: string;

  @IsOptional() @IsString()
  drawingTitleField?: string;

  @IsOptional() @IsString()
  disciplineField?: string;

  @IsOptional() @IsString()
  buildingOrZoneField?: string;

  @IsOptional() @IsString()
  floorOrLevelField?: string;

  @IsOptional() @IsString()
  revisionNumberField?: string;

  @IsOptional() @IsString()
  statusField?: string;

  @IsOptional() @IsString()
  issueDateField?: string;
}
