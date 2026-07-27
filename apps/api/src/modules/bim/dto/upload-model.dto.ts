import { IsString, IsOptional, IsIn } from 'class-validator';

export class UploadBimModelDto {
  @IsString() name: string;
  @IsOptional() @IsIn(['IFC','NWD','RVT']) format?: string;
  @IsOptional() @IsIn(['IFC2X3','IFC4','IFC4.3']) ifcSchema?: string;
}