import { IsOptional, IsString, MaxLength } from 'class-validator';

// aiBriefing is the exact narrative the frontend already generated (and the
// user already read) on the Risk tab -- sent as a POST body rather than a
// query param since it can run to a few paragraphs, mirroring the
// apiDownloadPost() convention used elsewhere for export inputs too long
// for a query string. Optional: the report renders fine without it, it's
// just omitted rather than faked.
export class GenerateRiskPdfDto {
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  aiBriefing?: string;
}
