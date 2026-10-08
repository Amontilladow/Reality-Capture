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
