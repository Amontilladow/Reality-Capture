import { IsString, IsOptional, IsNumber, IsInt, MinLength, MaxLength } from 'class-validator';

export class CreateLevelDto {
  @IsString() @MinLength(1) @MaxLength(100)
  name: string;

  @IsOptional() @IsNumber()
  elevationM?: number;

  @IsInt()
  levelOrder: number;
}
