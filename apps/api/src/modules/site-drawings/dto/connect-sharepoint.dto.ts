import { IsNotEmpty, IsString } from 'class-validator';

// The customer's own Microsoft 365 tenant ID (a GUID) or verified domain
// (e.g. 'contoso.onmicrosoft.com') -- the one genuinely per-company piece
// of SharePoint config (see sharepoint-graph-client.ts's own header
// comment on why there's no secret to collect here).
export class ConnectSharePointDto {
  @IsString() @IsNotEmpty()
  tenantId!: string;
}
