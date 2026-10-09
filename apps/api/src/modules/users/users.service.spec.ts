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
