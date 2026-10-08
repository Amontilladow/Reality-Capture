import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { DatabaseService } from '../../database/database.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { EmailService } from '../email/email.service';

// selfSignup() and forgotPassword()/generatePasswordResetToken() are
// covered here -- the rest of AuthService (login, refresh,
// acceptInvitation, resetPassword) has no prior test coverage either and
// is out of scope for this change.
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
    const email = { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) };
    const svc = new AuthService(
      db as unknown as DatabaseService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      email as unknown as EmailService,
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

describe('AuthService.forgotPassword', () => {
  function makeService(opts: { userExists?: boolean; sendSucceeds?: boolean } = {}) {
    const userExists = opts.userExists ?? true;
    const sendSucceeds = opts.sendSucceeds ?? true;

    const withSystemBypass = jest.fn((fn: (sql: unknown) => unknown) => fn(
      jest.fn().mockResolvedValue(
        userExists ? [{ id: 'user-1', companyId: 'company-1', email: 'pat@aecom.com' }] : [],
      ),
    ));
    const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(jest.fn().mockResolvedValue([])));

    const db = { withSystemBypass, withTenant };
    const jwt = { sign: jest.fn() };
    const config = { get: jest.fn((key: string) => (key === 'app.frontendUrl' ? 'https://app.example.com' : undefined)) };
    const sendPasswordResetEmail = sendSucceeds
      ? jest.fn().mockResolvedValue(undefined)
      : jest.fn().mockRejectedValue(new Error('SMTP not configured'));
    const email = { sendPasswordResetEmail };

    const svc = new AuthService(
      db as unknown as DatabaseService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      email as unknown as EmailService,
    );
    return { svc, withTenant, sendPasswordResetEmail };
  }

  it('does nothing (no token written, no email sent) when the email does not exist -- but still resolves successfully (enumeration protection)', async () => {
    const { svc, withTenant, sendPasswordResetEmail } = makeService({ userExists: false });
    await expect(svc.forgotPassword('nobody@example.com')).resolves.toBeUndefined();
    expect(withTenant).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('generates a token and emails the reset link when the email exists', async () => {
    const { svc, sendPasswordResetEmail } = makeService({ userExists: true, sendSucceeds: true });
    await svc.forgotPassword('pat@aecom.com');
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const [to, link] = sendPasswordResetEmail.mock.calls[0] as [string, string];
    expect(to).toBe('pat@aecom.com');
    expect(link).toMatch(/^https:\/\/app\.example\.com\/reset-password\?token=[0-9a-f]{64}$/);
  });

  it('still resolves successfully (never throws) when email sending fails -- SMTP down/unconfigured must not surface to the caller', async () => {
    const { svc } = makeService({ userExists: true, sendSucceeds: false });
    await expect(svc.forgotPassword('pat@aecom.com')).resolves.toBeUndefined();
  });
});
