import { IsString, IsOptional, IsDateString, IsIn } from 'class-validator';

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
}