import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SectionSevenViewOnlyGuard } from './section-seven-view-only.guard';

function makeContext(opts: { user?: unknown; method: string; path: string }) {
  const request = { user: opts.user, method: opts.method, path: opts.path, params: {} };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeGuard(isPublic: boolean | undefined) {
  const reflector = { getAllAndOverride: jest.fn(() => isPublic) } as unknown as Reflector;
  return new SectionSevenViewOnlyGuard(reflector);
}

const chairman = { companyId: 'c1', companyRole: 'chairman', id: 'u1' };
const generalManager = { companyId: 'c1', companyRole: 'general_manager', id: 'u2' };
const operationsManager = { companyId: 'c1', companyRole: 'operations_manager', id: 'u3' };
const engineeringManager = { companyId: 'c1', companyRole: 'engineering_manager', id: 'u4' };
const companyAdmin = { companyId: 'c1', companyRole: 'company_admin', id: 'u5' };

describe('SectionSevenViewOnlyGuard', () => {
  it('always passes @Public() routes without checking', () => {
    const guard = makeGuard(true);
    expect(guard.canActivate(makeContext({ user: chairman, method: 'POST', path: '/api/v1/projects/p1/risk/recalculate' }))).toBe(true);
  });

  it('passes through when there is no authenticated user', () => {
    const guard = makeGuard(false);
    expect(guard.canActivate(makeContext({ user: undefined, method: 'POST', path: '/api/v1/projects/p1/risk/recalculate' }))).toBe(true);
  });

  it('never restricts reads (GET), even for a section-7 role', () => {
    const guard = makeGuard(false);
    expect(guard.canActivate(makeContext({ user: chairman, method: 'GET', path: '/api/v1/projects/p1/risk' }))).toBe(true);
  });

  it.each([
    ['chairman', chairman],
    ['general_manager', generalManager],
    ['operations_manager', operationsManager],
  ])('blocks %s from writing to Risk/Reports/Snagging/Captures', (_name, user) => {
    const guard = makeGuard(false);
    const paths = [
      '/api/v1/projects/p1/risk/recalculate',
      '/api/v1/projects/p1/progress-reports/shares',
      '/api/v1/projects/p1/snag-items/s1',
      '/api/v1/projects/p1/captures',
    ];
    for (const path of paths) {
      expect(() => guard.canActivate(makeContext({ user, method: 'POST', path }))).toThrow(ForbiddenException);
    }
  });

  it('engineering_manager is never restricted by this guard (full access, per the owner\'s explicit exception)', () => {
    const guard = makeGuard(false);
    expect(
      guard.canActivate(makeContext({ user: engineeringManager, method: 'POST', path: '/api/v1/projects/p1/risk/recalculate' })),
    ).toBe(true);
  });

  it('company_admin (also "management" category, but not named in matrix section 7) keeps unrestricted access', () => {
    const guard = makeGuard(false);
    expect(
      guard.canActivate(makeContext({ user: companyAdmin, method: 'POST', path: '/api/v1/projects/p1/risk/recalculate' })),
    ).toBe(true);
  });

  it('does not restrict a section-7 role writing OUTSIDE Risk/Reports/Snagging/Captures (e.g. RFIs, which has its own matrix row)', () => {
    const guard = makeGuard(false);
    expect(
      guard.canActivate(makeContext({ user: chairman, method: 'POST', path: '/api/v1/projects/p1/rfis' })),
    ).toBe(true);
  });

  it('does not gate the AI Assistant\'s ask endpoint -- a query action, not a project-data mutation', () => {
    const guard = makeGuard(false);
    expect(
      guard.canActivate(makeContext({ user: chairman, method: 'POST', path: '/api/v1/projects/p1/assistant/ask' })),
    ).toBe(true);
  });
});
