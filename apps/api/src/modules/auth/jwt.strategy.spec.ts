import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import type { SessionRevocationService } from './session-revocation.service';
import type { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '@engineeringos/types';

// M-1 fix (KNOWN_ISSUES_AND_REMEDIATION.md): a deactivated user's
// pre-existing access token used to stay valid until its natural expiry,
// since validate() never checked anything beyond the signature Passport
// already verifies. These tests prove the deny-list check actually blocks
// (and allows) requests correctly, independent of SessionRevocationService's
// own Redis implementation (mocked here).
function makeStrategy(isDenied: boolean) {
  const config = { get: jest.fn(() => 'test-secret') } as unknown as ConfigService;
  const sessionRevocation = { isDenied: jest.fn().mockResolvedValue(isDenied) } as unknown as SessionRevocationService;
  const strategy = new JwtStrategy(config, sessionRevocation);
  return { strategy, sessionRevocation };
}

const basePayload: JwtPayload = {
  sub: 'user-1', companyId: 'company-1', email: 'u@example.com',
  companyRole: 'project_engineer', firstName: 'Pat', lastName: 'Lee', pendingApproval: false,
};

describe('JwtStrategy.validate', () => {
  it('rejects a token for a deactivated user, even though its signature and expiry are both valid', async () => {
    const { strategy, sessionRevocation } = makeStrategy(true);

    await expect(strategy.validate(basePayload)).rejects.toThrow(UnauthorizedException);
    expect(sessionRevocation.isDenied).toHaveBeenCalledWith('user-1');
  });

  it('allows a token for a user who has not been deactivated', async () => {
    const { strategy } = makeStrategy(false);

    const result = await strategy.validate(basePayload);

    expect(result).toEqual(expect.objectContaining({ id: 'user-1', companyId: 'company-1' }));
  });

  it('still rejects a structurally invalid payload before ever checking the deny-list', async () => {
    const { strategy, sessionRevocation } = makeStrategy(false);

    await expect(strategy.validate({ ...basePayload, sub: '' })).rejects.toThrow(UnauthorizedException);
    expect(sessionRevocation.isDenied).not.toHaveBeenCalled();
  });
});
