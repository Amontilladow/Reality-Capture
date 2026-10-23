import { IsNotEmpty, IsString } from 'class-validator';

export class GetSiteDrawingUploadUrlDto {
  @IsString() @IsNotEmpty()
  filename!: string;
}
