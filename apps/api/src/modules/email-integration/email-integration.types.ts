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

export interface EmailProviderClient {
  buildAuthorizeUrl(state: string): string;
  exchangeCodeForTokens(code: string): Promise<ProviderTokens>;
  refreshAccessToken(refreshToken: string): Promise<ProviderTokens>;
  // The provider's own "who am I" call -- confirms the actual mailbox
  // address the granted token can act as, rather than trusting the app's
  // own login email (a user's EngineeringOS login and their Microsoft/Google
  // account email are not guaranteed to match).
  fetchConnectedEmailAddress(accessToken: string): Promise<string>;
}

export interface DecryptedConnection {
  userId: string;
  connectedEmail: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
}
