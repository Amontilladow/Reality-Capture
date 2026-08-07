import { IsString, IsOptional, IsUUID, IsDateString, IsArray, IsIn } from 'class-validator';

export class UpdateIssueDto {
  @IsOptional() @IsString()  title?: string;
  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsIn(['critical','high','medium','low']) priority?: string;

  @IsOptional()
  @IsIn(['open','assigned','in_progress','resolved','under_review','closed','void',
    'waiting_for_information','reopened'])
  status?: string;

  @IsOptional() @IsIn(['MEP','ARC','STR','CIV','ELE','INFRA','LANDSCAPE','OTHER']) discipline?: string;

  @IsOptional()
  @IsIn(['design_issue','bim_modeling_issue','coordination_issue','clash_detection',
    'constructability_issue','shop_drawing_issue','site_issue','rfi',
    'client_comment','consultant_comment','other'])
  category?: string;

  @IsOptional() @IsString()  trade?: string;
  @IsOptional() @IsUUID()    buildingId?: string;
  @IsOptional() @IsUUID()    levelId?: string;
  @IsOptional() @IsUUID()    locationId?: string;
  @IsOptional() @IsUUID()    assignedTo?: string;
  @IsOptional() @IsString()  responsibleCompany?: string;
  @IsOptional() @IsDateString() deadline?: string;
  @IsOptional() @IsArray()   tags?: string[];
}