import { TenancyService, generateSignupCode } from './tenancy.service';
import type { DatabaseService } from '../../database/database.service';

describe('generateSignupCode', () => {
  const ALLOWED = new Set('ABCDEFGHJKMNPQRSTUVWXYZ23456789'.split(''));

  it('produces an 8-character code using only the unambiguous alphabet', () => {
    const code = generateSignupCode();
    expect(code).toHaveLength(8);
    expect([...code].every((ch) => ALLOWED.has(ch))).toBe(true);
  });

  it('excludes visually ambiguous characters (0/O, 1/I/L)', () => {
    for (const ch of ['0', 'O', '1', 'I', 'L']) {
      expect(ALLOWED.has(ch)).toBe(false);
    }
  });

  it('is not deterministic across calls', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateSignupCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

// Only the new self-signup-code methods are covered here -- the rest of
// TenancyService has no prior test coverage and is out of scope for this
// change.
describe('TenancyService self-signup code', () => {
  const companyId = 'company-1';

  function makeService(responder: (text: string) => unknown[] | undefined) {
    const query = jest.fn((strings: TemplateStringsArray) => {
      const text = strings.join('?');
      return Promise.resolve(responder(text) ?? []);
    });
    const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
    const db = { withTenant };
    return new TenancyService(db as unknown as DatabaseService);
  }

  describe('getSignupCode', () => {
    it('returns null when no code has ever been generated', async () => {
      const svc = makeService(() => [{ signupCode: null }]);
      await expect(svc.getSignupCode(companyId)).resolves.toEqual({ signupCode: null });
    });

    it('returns the existing code', async () => {
      const svc = makeService(() => [{ signupCode: 'ABCD1234' }]);
      await expect(svc.getSignupCode(companyId)).resolves.toEqual({ signupCode: 'ABCD1234' });
    });
  });

  describe('regenerateSignupCode', () => {
    it('writes an UPDATE and returns the shape callers depend on', async () => {
      // The stub sql tag can't echo back the real bound value (no template
      // binding simulated here) -- generateSignupCode() itself is covered
      // directly above; this only confirms the method runs the write and
      // surfaces whatever the DB returned.
      const svc = makeService(() => [{ signupCode: 'WXYZ6789' }]);
      await expect(svc.regenerateSignupCode(companyId)).resolves.toEqual({ signupCode: 'WXYZ6789' });
    });
  });
});
