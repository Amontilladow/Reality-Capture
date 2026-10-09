import { registerAs } from '@nestjs/config';

// Deliberately independent from google-calendar.config.ts's own
// GOOGLE_OAUTH_* vars (Phase 3A's decision: no shared client between
// Calendar and Gmail, so neither integration's configuration can break
// the other). Nothing stops pointing both at the same Google Cloud OAuth
// client if you want a single consent screen covering both features --
// that's a Google Cloud Console choice, not a code one.
export default registerAs('gmail', () => ({
  clientId: process.env.GMAIL_OAUTH_CLIENT_ID ?? '',
  clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET ?? '',
  // Must exactly match a redirect URI configured on the Google Cloud
  // Console OAuth client -- e.g.
  // https://engineeringos-api.onrender.com/api/v1/email-integration/gmail/callback
  redirectUri: process.env.GMAIL_OAUTH_REDIRECT_URI ?? '',
}));
