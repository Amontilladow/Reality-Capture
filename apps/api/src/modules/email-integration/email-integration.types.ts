// Internal (not exported from @engineeringos/types) -- these describe the
// shape every provider client (MicrosoftGraphClient, GmailClient -- Phase
// 3C/3D) must implement, and the plaintext token bundle EmailTokenStore
// encrypts before it ever reaches the database. Nothing here is returned
// to the frontend.

export interface ProviderTokens {
  accessToken: string;
  // Absent on a refresh response for some providers (Google only issues a
  // new refresh token on the initial grant, same as the existing Calendar
  // integration's GoogleTokens) -- only required on the very first connect.
  refreshToken?: string;
  expiresAt: string; // ISO timestamp
  // Exactly what the provider granted, space-separated -- not what was
  // requested. A provider can silently narrow a scope request; storing what
  // was actually granted is what Section 5's "appropriate token expiry
  // handling" and a later composer's "can this connection actually send
  // mail" check both need to be honest about.
  grantedScopes: string;
}

// The initial code-exchange additionally confirms which mailbox was
// actually granted, taken from the OIDC ID token's own email claim
// (requesting `openid email` alongside the send scope, both providers
// support this) rather than a second API call against Graph's /me or
// Google's userinfo endpoint -- one fewer scope to request
// (no User.Read / userinfo.email needed) and one fewer round trip.
// refreshToken is narrowed to required here (unlike the base type, which
// leaves it optional for a *refresh* response) -- every concrete client's
// exchangeCodeForTokens() throws rather than returning if the provider
// didn't grant one, so by the time this type is constructed it is always
// present.
export interface InitialProviderTokens extends ProviderTokens {
  refreshToken: string;
  connectedEmail: string;
}

export interface EmailProviderClient {
  buildAuthorizeUrl(state: string): string;
  exchangeCodeForTokens(code: string): Promise<InitialProviderTokens>;
  refreshAccessToken(refreshToken: string): Promise<ProviderTokens>;
}

export interface DecryptedConnection {
  userId: string;
  connectedEmail: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
}
