import { IsString, IsNumber, IsPositive, IsIn } from 'class-validator';

export class BrandingUploadUrlDto {
  @IsString() filename: string;
  @IsNumber() @IsPositive() sizeBytes: number;
  @IsIn(['logo', 'stamp']) kind: 'logo' | 'stamp';
}
