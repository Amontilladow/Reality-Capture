import { IsNotEmpty, IsString } from 'class-validator';

export class ExtractSiteDrawingFieldsDto {
  @IsString() @IsNotEmpty()
  storageKey!: string;
}
