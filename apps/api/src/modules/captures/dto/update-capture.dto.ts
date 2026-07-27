import { IsString, IsOptional, IsArray, IsUUID } from 'class-validator';

export class UpdateCaptureDto {
  @IsOptional() @IsString()  title?: string;
  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsString()  phase?: string;
  @IsOptional() @IsArray()   tags?: string[];
  @IsOptional() @IsUUID()    locationId?: string;
}