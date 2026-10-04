import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isIssueManager,
  ISSUE_MANAGER_ROLES,
  isOverdue,
  getDeadlineTimer,
  formatDeadline,
} from './issue-constants';

describe('isIssueManager', () => {
  it('returns false for undefined', () => {
    expect(isIssueManager(undefined)).toBe(false);
  });

  it('returns false for a role below engineering_manager', () => {
    expect(isIssueManager('consultant')).toBe(false);
    expect(isIssueManager('client_representative')).toBe(false);
  });

  it('returns true for engineering_manager and company_admin', () => {
    expect(isIssueManager('engineering_manager')).toBe(true);
    expect(isIssueManager('company_admin')).toBe(true);
  });

  // Regression guard for the F5 bug: a hardcoded
  // ['company_admin', 'engineering_manager'] list would silently exclude
  // these two roles, even though both outrank engineering_manager and the
  // backend's RolesGuard already treats them as permitted via weight
  // comparison, not list membership.
  it('returns true for roles that outrank engineering_manager (super_admin, technical_director)', () => {
    expect(isIssueManager('super_admin')).toBe(true);
    expect(isIssueManager('technical_director')).toBe(true);
  });
});

describe('ISSUE_MANAGER_ROLES', () => {
  it('includes every role at or above engineering_manager, and nothing below it', () => {
    expect(ISSUE_MANAGER_ROLES).toEqual(
      expect.arrayContaining(['super_admin', 'technical_director', 'company_admin', 'engineering_manager']),
    );
    expect(ISSUE_MANAGER_ROLES).not.toContain('consultant');
    expect(ISSUE_MANAGER_ROLES).not.toContain('client_representative');
  });
});

describe('isOverdue', () => {
  it('returns false when there is no deadline', () => {
    expect(isOverdue(undefined, 'open')).toBe(false);
  });

  it('returns false for closed/void issues even if the deadline has passed', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isOverdue(past, 'closed')).toBe(false);
    expect(isOverdue(past, 'void')).toBe(false);
  });

  it('returns true for a past deadline on an active issue', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isOverdue(past, 'open')).toBe(true);
  });

  it('returns false for a future deadline', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isOverdue(future, 'open')).toBe(false);
  });
});

describe('getDeadlineTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is closed for a closed/void issue regardless of deadline', () => {
    expect(getDeadlineTimer('2020-01-01T00:00:00Z', 'closed').state).toBe('closed');
    expect(getDeadlineTimer(undefined, 'void').state).toBe('closed');
  });

  it('is ok when there is no deadline', () => {
    expect(getDeadlineTimer(undefined, 'open').state).toBe('ok');
  });

  it('is overdue once the deadline has passed', () => {
    expect(getDeadlineTimer('2026-10-03T00:00:00Z', 'open').state).toBe('overdue');
  });

  it('is warn within 48 hours of the deadline', () => {
    expect(getDeadlineTimer('2026-10-05T06:00:00Z', 'open').state).toBe('warn');
  });

  it('is ok when more than 48 hours remain', () => {
    expect(getDeadlineTimer('2026-10-10T00:00:00Z', 'open').state).toBe('ok');
  });
});

describe('formatDeadline', () => {
  it('returns an em-dash placeholder when there is no deadline', () => {
    expect(formatDeadline(undefined)).toBe('—');
  });

  it('formats a real deadline as day/month/year', () => {
    expect(formatDeadline('2026-03-05T00:00:00Z')).toMatch(/2026/);
  });
});
