import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class CreateLocationDto {
  @IsString() @MinLength(1) @MaxLength(255)
  name: string;

  @IsOptional() @IsString()
  description?: string;
}
