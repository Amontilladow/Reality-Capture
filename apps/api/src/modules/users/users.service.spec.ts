import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import type { DatabaseService } from '../../database/database.service';
import type { SubscriptionService } from '../subscription/subscription.service';
import type { AuthService } from '../auth/auth.service';

describe('UsersService.adminResetPassword', () => {
  function makeService(opts: { targetRow?: Record<string, unknown> | null } = {}) {
    const targetRow = opts.targetRow === undefined ? { id: 'user-2', email: 'target@aecom.com', isActive: true } : opts.targetRow;
    const withTenant = jest.fn().mockResolvedValue(targetRow ? [targetRow] : []);
    const db = { withTenant };

    const subscription = {} as unknown as SubscriptionService;

    const generatePasswordResetToken = jest.fn().mockResolvedValue({
      token: 'a'.repeat(64),
      expiresAt: new Date('2026-01-01T13:00:00.000Z'),
    });
    const buildPasswordResetLink = jest.fn((token: string) => `https://app.example.com/reset-password?token=${token}`);
    const auth = { generatePasswordResetToken, buildPasswordResetLink };

    const svc = new UsersService(
      db as unknown as DatabaseService,
      subscription,
      auth as unknown as AuthService,
    );
    return { svc, generatePasswordResetToken, buildPasswordResetLink };
  }

  it("generates a link via AuthService's shared token helper (same mechanism forgotPassword() uses) and returns it directly", async () => {
    const { svc, generatePasswordResetToken, buildPasswordResetLink } = makeService();

    const result = await svc.adminResetPassword('company-1', 'user-2');

    expect(generatePasswordResetToken).toHaveBeenCalledWith('company-1', 'user-2');
    expect(buildPasswordResetLink).toHaveBeenCalledWith('a'.repeat(64));
    expect(result).toEqual({
      resetLink: 'https://app.example.com/reset-password?token=' + 'a'.repeat(64),
      expiresAt: '2026-01-01T13:00:00.000Z',
    });
  });

  it('throws NotFoundException for a user that does not exist in this company', async () => {
    const { svc, generatePasswordResetToken } = makeService({ targetRow: null });
    await expect(svc.adminResetPassword('company-1', 'nonexistent')).rejects.toThrow(NotFoundException);
    expect(generatePasswordResetToken).not.toHaveBeenCalled();
  });

  it('refuses to reset the password of a deactivated account', async () => {
    const { svc, generatePasswordResetToken } = makeService({ targetRow: { id: 'user-2', email: 'target@aecom.com', isActive: false } });
    await expect(svc.adminResetPassword('company-1', 'user-2')).rejects.toThrow(ForbiddenException);
    expect(generatePasswordResetToken).not.toHaveBeenCalled();
  });
});

// Phase 4F: onboardingCompleted is stored in the existing preferences
// JSONB column, written through the same self-profile-edit path as
// firstName/lastName/phone -- these tests cover that it's wired into
// update()'s hasUpdates gate and authorization the same way those are,
// and that the service flattens preferences.onboardingCompleted onto the
// returned object for the caller's convenience.
describe('UsersService.update -- onboardingCompleted', () => {
  function makeService(findOneRow: Record<string, unknown>, updateRow: Record<string, unknown>) {
    const withTenant = jest.fn()
      .mockResolvedValueOnce([findOneRow])
      .mockResolvedValueOnce([updateRow]);
    const db = { withTenant };
    const svc = new UsersService(
      db as unknown as DatabaseService,
      {} as unknown as SubscriptionService,
      {} as unknown as AuthService,
    );
    return { svc, withTenant };
  }

  it('lets a user mark their own onboarding complete without any admin role', async () => {
    const { svc, withTenant } = makeService(
      { id: 'user-2', companyRole: 'project_engineer', isActive: true, preferences: {} },
      { id: 'user-2', email: 'target@aecom.com', preferences: { onboardingCompleted: true } },
    );

    const result = await svc.update('company-1', 'user-2', 'project_engineer', 'user-2', { onboardingCompleted: true });

    expect(withTenant).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({ onboardingCompleted: true }));
  });

  it('lets a user restart (uncomplete) their own onboarding', async () => {
    const { svc } = makeService(
      { id: 'user-2', companyRole: 'consultant', isActive: true, preferences: { onboardingCompleted: true } },
      { id: 'user-2', email: 'target@aecom.com', preferences: { onboardingCompleted: false } },
    );

    const result = await svc.update('company-1', 'user-2', 'consultant', 'user-2', { onboardingCompleted: false });

    expect(result).toEqual(expect.objectContaining({ onboardingCompleted: false }));
  });

  it('does not touch the database when onboardingCompleted is the only field and already unset', async () => {
    const { svc, withTenant } = makeService(
      { id: 'user-2', companyRole: 'consultant', isActive: true, preferences: {} },
      {},
    );

    const result = await svc.update('company-1', 'user-2', 'consultant', 'user-2', {});

    // hasUpdates is false for an empty dto -- findOne() still runs (1 call),
    // the UPDATE never does.
    expect(withTenant).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'user-2', companyRole: 'consultant', isActive: true, preferences: {} });
  });

  it('still blocks one user from completing onboarding on someone else\'s behalf unless they are an admin', async () => {
    const { svc } = makeService(
      { id: 'user-2', companyRole: 'consultant', isActive: true, preferences: {} },
      {},
    );

    await expect(
      svc.update('company-1', 'user-3', 'consultant', 'user-2', { onboardingCompleted: true }),
    ).rejects.toThrow(ForbiddenException);
  });
});

// Phase 6 security fix regression tests: RolesGuard only checks that the
// CALLER's own weight clears @Roles('company_admin','engineering_manager',
// 'project_manager')'s minimum (project_manager, weight 60) -- it says
// nothing about the weight of the companyRole in the request body. Before
// this fix, invite() inserted dto.companyRole verbatim, so a project_manager
// (or bim_manager/technical_director/engineering_manager) could invite a
// brand-new user with companyRole: 'super_admin' and it would be granted
// immediately, no approval step. Confirmed live during the Phase 6 audit.
describe('UsersService.invite -- role escalation cap', () => {
  function makeService() {
    // invite() only reaches its first withTenant call (the existing-user
    // lookup) if the role-weight check passes -- these tests assert the
    // escalation attempts throw before that, so the mock's resolved value
    // is irrelevant for the rejection cases and only exercised by the
    // "allowed" case.
    const withTenant = jest.fn().mockResolvedValue([]);
    const db = { withTenant };
    const subscription = { checkLimit: jest.fn().mockResolvedValue({ allowed: true }) };
    const svc = new UsersService(
      db as unknown as DatabaseService,
      subscription as unknown as SubscriptionService,
      {} as unknown as AuthService,
    );
    return { svc, withTenant };
  }

  it('refuses to let a project_manager invite a new user as super_admin', async () => {
    const { svc, withTenant } = makeService();

    await expect(
      svc.invite('company-1', 'inviter-1', 'project_manager', { email: 'escalated@evil.example', companyRole: 'super_admin' }),
    ).rejects.toThrow(ForbiddenException);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('refuses to let a consultant invite a new user as company_admin', async () => {
    const { svc, withTenant } = makeService();

    await expect(
      svc.invite('company-1', 'inviter-1', 'consultant', { email: 'escalated@evil.example', companyRole: 'company_admin' }),
    ).rejects.toThrow(ForbiddenException);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('allows inviting a role at or below the inviter\'s own weight', async () => {
    const { svc, withTenant } = makeService();
    withTenant
      .mockResolvedValueOnce([]) // existing-user lookup: none found
      .mockResolvedValueOnce([{ id: 'new-user-1', email: 'new.engineer@aecom.com' }]); // insert

    const result = await svc.invite('company-1', 'inviter-1', 'project_manager', { email: 'new.engineer@aecom.com', companyRole: 'consultant' });

    expect(result).toEqual(expect.objectContaining({ id: 'new-user-1', email: 'new.engineer@aecom.com' }));
  });

  it('allows a super_admin to invite another super_admin (equal weight is not an escalation)', async () => {
    const { svc, withTenant } = makeService();
    withTenant
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'new-user-2', email: 'new.admin@aecom.com' }]);

    const result = await svc.invite('company-1', 'inviter-1', 'super_admin', { email: 'new.admin@aecom.com', companyRole: 'super_admin' });

    expect(result).toEqual(expect.objectContaining({ id: 'new-user-2' }));
  });

  it('allows inviting with no companyRole at all (defers to the pending-approval flow), regardless of inviter weight', async () => {
    const { svc, withTenant } = makeService();
    withTenant
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'new-user-3', email: 'new.consultant@aecom.com' }]);

    const result = await svc.invite('company-1', 'inviter-1', 'project_manager', { email: 'new.consultant@aecom.com' });

    expect(result).toEqual(expect.objectContaining({ id: 'new-user-3' }));
  });
});
