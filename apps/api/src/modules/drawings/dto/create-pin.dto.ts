import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePinDto {
  @IsNumber() posXNorm: number;   // normalized 0.0–1.0 on the drawing canvas
  @IsNumber() posYNorm: number;
  @IsOptional() @IsString() @MaxLength(255) name?: string;
}
