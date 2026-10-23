import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { DOC_SOURCES, type DocSource } from '@engineeringos/types';

export class GetImportBatchUploadUrlDto {
  @IsString() @IsNotEmpty()
  filename!: string;
}

// The uploader identifies where the package actually came from (brief
// section 2: "identify its source, such as Aconex, Procore or another
// source") -- this app has no live API access to Aconex/Procore (section
// 2: "initial ingestion uses files downloaded by authorized users"), so
// the resulting drawings' sourceProvider is set from this field, not
// inferred.
export class CreateImportBatchDto {
  @IsString() @IsNotEmpty()
  storageKey!: string;

  @IsString() @IsNotEmpty()
  originalFilename!: string;

  @IsIn(DOC_SOURCES)
  sourceSystem!: DocSource;
}
