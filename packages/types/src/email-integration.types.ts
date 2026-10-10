// Phase 3: Outlook & Gmail integration. Shared shapes only — provider-specific
// request/response bodies live alongside each provider's own module.

export type EmailProvider = 'microsoft' | 'google';

// Mirrors the brief's own status vocabulary (SETTINGS -> EMAIL INTEGRATION).
// 'connecting' is a frontend-only transient state (the moment between
// redirecting to the provider and the callback landing) -- the backend
// never persists it, so it never appears in an API response.
export type EmailIntegrationStatusValue =
  | 'not_connected'
  | 'connected'
  | 'connection_expired'
  | 'authorization_required'
  | 'error';

export interface EmailIntegrationStatus {
  provider: EmailProvider;
  status: EmailIntegrationStatusValue;
  connectedEmail: string | null;
  connectedAt: string | null;
  lastUsedAt: string | null;
  lastErrorMessage: string | null;
}
