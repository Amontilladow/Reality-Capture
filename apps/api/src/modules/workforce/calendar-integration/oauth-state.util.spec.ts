import { createHmac } from 'node:crypto';
import { signOAuthState, verifyOAuthState } from './oauth-state.util';

const secret = 'test-secret';

describe('signOAuthState / verifyOAuthState', () => {
  it('round-trips companyId and userId through a signed state token', () => {
    const state = signOAuthState(secret, 'company-1', 'user-1');
    const payload = verifyOAuthState(secret, state);
    expect(payload.companyId).toBe('company-1');
    expect(payload.userId).toBe('user-1');
  });

  it('rejects a state signed with a different secret', () => {
    const state = signOAuthState('other-secret', 'company-1', 'user-1');
    expect(() => verifyOAuthState(secret, state)).toThrow('Invalid OAuth state signature');
  });

  it('rejects a tampered payload even if the signature format still parses', () => {
    const state = signOAuthState(secret, 'company-1', 'user-1');
    const [payloadB64, signature] = state.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ companyId: 'attacker-company', userId: 'user-1', issuedAt: Date.now() })).toString('base64url');
    expect(() => verifyOAuthState(secret, `${tamperedPayload}.${signature}`)).toThrow('Invalid OAuth state signature');
    // Sanity check the untampered payload really does differ from the tampered one.
    expect(payloadB64).not.toBe(tamperedPayload);
  });

  it('rejects a malformed state with no signature segment', () => {
    expect(() => verifyOAuthState(secret, 'not-a-valid-state')).toThrow('Malformed OAuth state');
  });

  it('rejects an expired state', () => {
    const staleTimestamp = Date.now() - 11 * 60 * 1000; // 11 minutes ago, past the 10-minute TTL
    const payloadB64 = Buffer.from(JSON.stringify({ companyId: 'company-1', userId: 'user-1', issuedAt: staleTimestamp })).toString('base64url');
    const signature = createHmac('sha256', secret).update(payloadB64).digest('base64url');
    expect(() => verifyOAuthState(secret, `${payloadB64}.${signature}`)).toThrow('OAuth state expired');
  });
});
