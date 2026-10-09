import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EmailProvider } from '@engineeringos/types';

// Same signed, self-describing state design as
// workforce/calendar-integration/oauth-state.util.ts (see that file's own
// comment for the full reasoning: no pre-tenant DB lookup needed to resume
// an OAuth callback). Kept as its own copy rather than importing/generalizing
// the existing one -- the calendar integration is live, working code this
// phase must not touch (see migration 065's header comment), and the one
// real difference here (the `provider` field) is exactly the kind of change
// that would otherwise need modifying code outside this new module's own
// files.
//
// `provider` is embedded and re-verified by the caller against the route it
// arrived on, so a state signed for the Outlook flow can't be replayed
// against the Gmail callback (or vice versa) even though both share the same
// signing secret.

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes, same window as calendar-integration's

export interface EmailOAuthStatePayload {
  companyId: string;
  userId: string;
  provider: EmailProvider;
  issuedAt: number;
}

export function signEmailOAuthState(secret: string, companyId: string, userId: string, provider: EmailProvider): string {
  const payload: EmailOAuthStatePayload = { companyId, userId, provider, issuedAt: Date.now() };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

export function verifyEmailOAuthState(secret: string, state: string, expectedProvider: EmailProvider): EmailOAuthStatePayload {
  const parts = state.split('.');
  if (parts.length !== 2) throw new Error('Malformed OAuth state');
  const [payloadB64, signature] = parts;

  const expectedSignature = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    throw new Error('Invalid OAuth state signature');
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as EmailOAuthStatePayload;
  if (Date.now() - payload.issuedAt > STATE_TTL_MS) {
    throw new Error('OAuth state expired');
  }
  if (payload.provider !== expectedProvider) {
    throw new Error('OAuth state was issued for a different provider');
  }
  return payload;
}
