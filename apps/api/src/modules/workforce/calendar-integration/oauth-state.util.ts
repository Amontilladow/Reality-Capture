import { createHmac, timingSafeEqual } from 'node:crypto';

// Google's OAuth redirect callback (GET .../callback?code=...&state=...) is
// a browser redirect, not an authenticated API request -- there is no JWT
// bearer token, no request.user, no tenant context. Rather than storing
// pending-connection state server-side keyed by an opaque `state` value
// (which the callback would then need to look up via a pre-tenant,
// cross-company query -- the same production RLS-bootstrap-role gap
// already documented for TenancyService.register() and the screenshot
// retention cron), the state parameter itself carries a signed,
// self-describing payload: which company and user initiated this, and
// when. The callback verifies the signature and expiry and is done --
// no database lookup needed at all, and no new instance of that shared gap.
//
// Signed with the same JWT_ACCESS_SECRET this app already has (see
// config/jwt.config.ts) rather than a new required env var -- this is not
// a JWT (no need for the full library/format), just an HMAC-authenticated
// payload with the same "don't invent a second secret for a similar job"
// reasoning.

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes -- long enough for a real Google consent flow, short enough that a stale/leaked state URL is only a brief liability.

export interface OAuthStatePayload {
  companyId: string;
  userId: string;
  issuedAt: number;
}

export function signOAuthState(secret: string, companyId: string, userId: string): string {
  const payload: OAuthStatePayload = { companyId, userId, issuedAt: Date.now() };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

export function verifyOAuthState(secret: string, state: string): OAuthStatePayload {
  const parts = state.split('.');
  if (parts.length !== 2) throw new Error('Malformed OAuth state');
  const [payloadB64, signature] = parts;

  const expectedSignature = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  // Length check before timingSafeEqual -- it throws on mismatched lengths
  // rather than returning false, and the length check itself leaks no more
  // than the signature's own fixed length already would.
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    throw new Error('Invalid OAuth state signature');
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as OAuthStatePayload;
  if (Date.now() - payload.issuedAt > STATE_TTL_MS) {
    throw new Error('OAuth state expired');
  }
  return payload;
}
