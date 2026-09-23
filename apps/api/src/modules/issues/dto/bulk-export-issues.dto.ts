import { IsArray, ArrayNotEmpty, IsUUID } from 'class-validator';

export class BulkExportIssuesDto {
  @IsArray() @ArrayNotEmpty() @IsUUID('4', { each: true })
  issueIds: string[];
}
