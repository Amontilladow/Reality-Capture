import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

// Raw HTTP wrapper over Microsoft Graph's app-only (client-credentials)
// flow for SharePoint -- deliberately no MSAL/Graph SDK dependency, same
// preference this codebase's other Microsoft Graph client already states
// (outlook/microsoft-graph-client.ts's own header comment). That client
// uses a *delegated* (per-user, authorization-code) grant for Outlook;
// this one is *application* (client-credentials, no signed-in user) --
// the right shape for a server-side sync job that runs with no user
// present, matching brief section 6's "server-side sync jobs" framing.
//
// Reuses this app's ONE existing Entra app registration
// (MICROSOFT_OAUTH_CLIENT_ID/_SECRET, config/microsoft-graph.config.ts) --
// not a second, SharePoint-specific registration. What's genuinely
// per-company here is only the CUSTOMER'S OWN tenant ID (see
// SiteDrawingSharePointAdapter's own comment): a client-credentials token
// request must target a specific tenant, unlike the delegated flow's
// 'organizations' alias.
//
// Required Entra configuration (admin-provisioned, outside this app):
// 1. The tenant admin grants this app's registration the
//    `Sites.Selected` APPLICATION permission (least-privilege: scoped to
//    specific sites, not every SharePoint site in the tenant) and
//    completes admin consent.
// 2. For each SharePoint site this adapter should reach, the admin (or
//    someone with site-owner rights) grants this app `read` (or `write`,
//    if a future phase needs to write back) access via
//    `POST /sites/{siteId}/permissions` -- there is no way to do this
//    from inside RealityCapture itself; it's a one-time, per-site grant
//    the customer's own admin makes directly against Graph.
// Until both are done for a given tenant/site, every call below fails
// with a 403/Forbidden, surfaced as getSourceHealth().reachable = false,
// never silently treated as "no drawings found."
@Injectable()
export class SharePointGraphClient {
  private readonly logger = new Logger(SharePointGraphClient.name);
  // One cached app-only token per customer tenant -- a tenant's token is
  // never reused for another tenant's data, and never persisted outside
  // process memory (it's a short-lived Graph access token, not a secret
  // worth encrypting at rest; it's gone on process restart, which simply
  // means the next call re-requests one).
  private readonly tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private async getAppToken(tenantId: string): Promise<string> {
    const cached = this.tokenCache.get(tenantId);
    // 60s buffer so a token is never handed out right as it expires mid-call.
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

    const clientId = this.config.get<string>('microsoftGraph.clientId');
    const clientSecret = this.config.get<string>('microsoftGraph.clientSecret');
    if (!clientId || !clientSecret) {
      throw new Error('Microsoft Graph app credentials are not configured (MICROSOFT_OAUTH_CLIENT_ID/_SECRET).');
    }

    const res = await firstValueFrom(this.http.post<{ access_token: string; expires_in: number }>(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    ));

    this.tokenCache.set(tenantId, {
      accessToken: res.data.access_token,
      expiresAt: Date.now() + res.data.expires_in * 1000,
    });
    return res.data.access_token;
  }

  // Generic authenticated GET -- every read below goes through this so
  // the 401/403/404 handling (and the "never log a token" rule) lives in
  // one place. Returns null for a 404 (not found/no longer exists, a real
  // and expected outcome -- e.g. a deleted driveItem), rethrows anything
  // else so the caller can tell "not found" apart from "source
  // unreachable."
  async get<T>(tenantId: string, path: string): Promise<T | null> {
    const token = await this.getAppToken(tenantId);
    try {
      const res = await firstValueFrom(this.http.get<T>(
        path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`,
        { headers: { Authorization: `Bearer ${token}` } },
      ));
      return res.data;
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 404) return null;
      throw err;
    }
  }

  // The @microsoft.graph.downloadUrl Graph hands back for a driveItem is a
  // pre-authenticated, time-limited URL the browser can fetch directly
  // with no Authorization header -- the same shape our own S3 presigned
  // GET URLs already have, which is exactly what getAuthorizedFile() needs
  // to return. Commonly cited as valid for about an hour, though Microsoft
  // does not document an exact, guaranteed lifetime -- callers should treat
  // the reported expiresInSeconds as approximate, not relied upon to the
  // second.
  async getCurrentDownloadUrl(tenantId: string, driveId: string, itemId: string): Promise<string | null> {
    const item = await this.get<{ '@microsoft.graph.downloadUrl'?: string }>(
      tenantId, `/drives/${driveId}/items/${itemId}?$select=id,@microsoft.graph.downloadUrl`,
    );
    return item?.['@microsoft.graph.downloadUrl'] ?? null;
  }

  // A specific historical version has no @microsoft.graph.downloadUrl
  // field of its own -- Graph instead 302-redirects GET .../content to a
  // time-limited blob URL, the same mechanism the current-version
  // downloadUrl is backed by. Captured here by disabling axios's own
  // redirect-following and reading the Location header, rather than
  // letting axios follow it (which would download the whole file through
  // this server for no reason -- getAuthorizedFile() only needs the URL
  // itself, handed to the browser to fetch directly).
  async getVersionContentUrl(tenantId: string, driveId: string, itemId: string, versionId: string): Promise<string | null> {
    const token = await this.getAppToken(tenantId);
    try {
      const res = await firstValueFrom(this.http.get(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/versions/${versionId}/content`,
        { headers: { Authorization: `Bearer ${token}` }, maxRedirects: 0, validateStatus: (s) => s === 302 },
      ));
      return (res.headers.location as string | undefined) ?? null;
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 404) return null;
      throw err;
    }
  }

  async post<T>(tenantId: string, path: string, body: unknown): Promise<T> {
    const token = await this.getAppToken(tenantId);
    const res = await firstValueFrom(this.http.post<T>(
      `https://graph.microsoft.com/v1.0${path}`, body,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    ));
    return res.data;
  }
}
