import { IsString, MinLength, MaxLength } from 'class-validator';

export class GetDrawingUploadUrlDto {
  @IsString() @MinLength(1) @MaxLength(255)
  filename: string;
}
