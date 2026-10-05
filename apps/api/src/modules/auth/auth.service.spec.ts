import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { DatabaseService } from '../../database/database.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';

// Only selfSignup() is covered here -- the rest of AuthService (login,
// refresh, acceptInvitation, forgot/reset-password) has no prior test
// coverage either and is out of scope for this change; these tests lock in
// the one new method this feature adds.
describe('AuthService.selfSignup', () => {
  const signupCode = 'ABCD1234';
  const companyId = 'company-1';

  function makeService(opts: {
    companyExists?: boolean;
    companyActive?: boolean;
    existingEmail?: boolean;
  }) {
    const companyExists = opts.companyExists ?? true;
    const companyActive = opts.companyActive ?? true;
    const existingEmail = opts.existingEmail ?? false;

    const withSystemBypass = jest.fn((fn: (sql: unknown) => unknown) => fn(
      jest.fn().mockResolvedValue(
        companyExists ? [{ id: companyId, isActive: companyActive }] : [],
      ),
    ));

    const insertedUser = {
      id: 'user-1', companyId, email: 'someone@aecom.com',
      firstName: 'Pat', lastName: 'Consultant',
      companyRole: 'client_representative', requestedCompanyRole: 'consultant',
    };
    const query = jest.fn()
      .mockResolvedValueOnce(existingEmail ? [{ id: 'existing-user' }] : []) // the existing-email SELECT
      .mockResolvedValueOnce([insertedUser]); // the INSERT ... RETURNING *
    const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));

    const db = { withSystemBypass, withTenant };
    const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    const config = { get: jest.fn().mockReturnValue('15m') };
    const svc = new AuthService(
      db as unknown as DatabaseService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
    );
    return { svc };
  }

  const baseDto = {
    signupCode,
    firstName: 'Pat',
    lastName: 'Consultant',
    email: 'someone@aecom.com',
    password: 'TestPass123!',
    organizationName: 'AECOM',
    requestedRole: 'consultant' as const,
  };

  it('creates an account pending approval when the signup code resolves to an active company', async () => {
    const { svc } = makeService({});
    const result = await svc.selfSignup(baseDto);
    expect(result.user.pendingApproval).toBe(true);
    expect(result.tokens.accessToken).toBe('signed.jwt.token');
  });

  it('rejects an unknown signup code', async () => {
    const { svc } = makeService({ companyExists: false });
    await expect(svc.selfSignup(baseDto)).rejects.toThrow(BadRequestException);
  });

  it("rejects a code belonging to a company that's been deactivated", async () => {
    const { svc } = makeService({ companyActive: false });
    await expect(svc.selfSignup(baseDto)).rejects.toThrow(BadRequestException);
  });

  it('rejects an email that already has an account at this company', async () => {
    const { svc } = makeService({ existingEmail: true });
    await expect(svc.selfSignup(baseDto)).rejects.toThrow(ConflictException);
  });
});
