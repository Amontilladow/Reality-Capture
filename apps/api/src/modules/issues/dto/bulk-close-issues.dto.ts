import { IsArray, ArrayNotEmpty, IsUUID } from 'class-validator';

export class BulkCloseIssuesDto {
  @IsArray() @ArrayNotEmpty() @IsUUID('4', { each: true })
  issueIds: string[];
}
