import { IsString, IsOptional, IsDateString, IsIn } from 'class-validator';

const PROJECT_PHASES = [
  'pre_construction', 'demolition', 'excavation', 'foundation', 'structure',
  'mep_rough_in', 'external_envelope', 'internal_fit_out', 'finishes',
  'commissioning', 'handover', 'post_occupancy',
];

export class UpdateProjectDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() expectedEndDate?: string;
  @IsOptional() @IsIn(['active','on_hold','completed','archived']) status?: string;
  @IsOptional() @IsIn(PROJECT_PHASES) phase?: string;

  // Stakeholder directory -- see create-project.dto.ts for context.
  @IsOptional() @IsString() orgCode?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() leadDesigner?: string;
  @IsOptional() @IsString() consultantName?: string;
  @IsOptional() @IsString() technicalAdvisor?: string;
  @IsOptional() @IsString() pmcName?: string;
  @IsOptional() @IsString() mainContractor?: string;
  @IsOptional() @IsString() subcontractor?: string;
}