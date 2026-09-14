import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PRODUCTIVITY_CLASSIFICATIONS } from '@engineeringos/types';

export class UpdateApplicationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255)
  name?: string;

  @IsOptional() @IsString() @MaxLength(100)
  category?: string;

  @IsOptional() @IsString() @MaxLength(100)
  discipline?: string;

  @IsOptional() @IsIn(PRODUCTIVITY_CLASSIFICATIONS)
  productivityClassification?: string;

  @IsOptional() @IsBoolean()
  engineeringRelevance?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
