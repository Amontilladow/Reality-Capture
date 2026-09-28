import { IsString, IsOptional, IsInt, Min, MinLength, MaxLength } from 'class-validator';

export class CreateBuildingDto {
  @IsString() @MinLength(1) @MaxLength(255)
  name: string;

  @IsOptional() @IsString() @MaxLength(50)
  code?: string;

  @IsOptional() @IsInt() @Min(0)
  totalLevels?: number;
}
