import { IsString, IsOptional, IsUUID, IsNumber } from 'class-validator';

export class CreateDrawingDto {
  @IsString()  title: string;
  @IsString()  storageKey: string;
  @IsOptional() @IsUUID()   levelId?: string;
  @IsOptional() @IsString() drawingNumber?: string;
  @IsOptional() @IsString() revision?: string;
  @IsOptional() @IsString() drawingType?: string;
  @IsOptional() @IsNumber() widthPx?: number;
  @IsOptional() @IsNumber() heightPx?: number;
  @IsOptional() @IsNumber() scaleRatio?: number;
  @IsOptional() @IsNumber() scalePxPerM?: number;
}