import { signEmailOAuthState, verifyEmailOAuthState } from './oauth-state.util';

const secret = 'test-secret';
const companyId = 'company-1';
const userId = 'user-1';

describe('signEmailOAuthState / verifyEmailOAuthState', () => {
  it('round-trips a valid state for the matching provider', () => {
    const state = signEmailOAuthState(secret, companyId, userId, 'microsoft');
    const payload = verifyEmailOAuthState(secret, state, 'microsoft');
    expect(payload).toMatchObject({ companyId, userId, provider: 'microsoft' });
  });

  it('rejects a state signed with a different secret', () => {
    const state = signEmailOAuthState(secret, companyId, userId, 'google');
    expect(() => verifyEmailOAuthState('wrong-secret', state, 'google')).toThrow('Invalid OAuth state signature');
  });

  it('rejects a malformed state', () => {
    expect(() => verifyEmailOAuthState(secret, 'not-a-real-state', 'google')).toThrow('Malformed OAuth state');
  });

  it('rejects a state issued for a different provider than the callback route expects', () => {
    // Exactly the cross-flow replay this module's own state format exists to prevent:
    // a state signed for Outlook's callback must not be accepted by Gmail's.
    const state = signEmailOAuthState(secret, companyId, userId, 'microsoft');
    expect(() => verifyEmailOAuthState(secret, state, 'google')).toThrow('OAuth state was issued for a different provider');
  });

  it('rejects an expired state', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const state = signEmailOAuthState(secret, companyId, userId, 'google');
    jest.setSystemTime(new Date('2026-01-01T00:11:00.000Z')); // 11 minutes later, past the 10-minute TTL
    expect(() => verifyEmailOAuthState(secret, state, 'google')).toThrow('OAuth state expired');
    jest.useRealTimers();
  });
});
