import { IsString, IsOptional, IsDateString, IsUUID, IsIn } from 'class-validator';

export class CreateTimelineEntryDto {
  @IsIn(['pre_construction','demolition','excavation','foundation','structure',
    'mep_rough_in','external_envelope','internal_fit_out','finishes',
    'commissioning','handover','post_occupancy'])
  phase: string;

  @IsDateString() entryDate: string;
  @IsString()     title: string;
  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsString()  workType?: string;
  @IsOptional() @IsUUID()    locationId?: string;
  @IsOptional() @IsUUID()    captureId?: string;
}