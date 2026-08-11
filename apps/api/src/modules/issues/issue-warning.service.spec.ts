import { IssueWarningService } from './issue-warning.service';
import type { DatabaseService } from '../../database/database.service';

describe('IssueWarningService.checkOverdueIssues', () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000 - 3600_000).toISOString();

  function makeQuery(responder: (text: string, values: unknown[]) => unknown[] | undefined) {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const query = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      calls.push({ text, values });
      return Promise.resolve(responder(text, values) ?? []);
    });
    // The per-issue recent-warning check and auto_warning insert now go through withTenant
    // (company_id is known at that point) -- forward its callback to the same text-keyed
    // query mock. Only the outer overdue scan still uses plain query, unchanged.
    const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
    return { query: query as unknown as DatabaseService['query'], withTenant, calls };
  }

  it('inserts an auto_warning activity for an overdue issue with no recent warning', async () => {
    const { query, withTenant, calls } = makeQuery((text) => {
      if (text.includes('FROM issues')) {
        return [{ id: 'issue-1', companyId: 'company-1', createdBy: 'user-1', deadline: yesterday }];
      }
      if (text.includes('activity_type = \'auto_warning\'')) {
        return []; // no recent warning -- not deduped
      }
      return undefined;
    });
    const svc = new IssueWarningService({ query, withTenant } as unknown as DatabaseService);

    const result = await svc.checkOverdueIssues();

    expect(result).toEqual({ checked: 1, warned: 1, skipped: 0 });
    const insertCall = calls.find(c => c.text.includes('INSERT INTO issue_activities'));
    expect(insertCall).toBeDefined();
    // values = [issueId, companyId, message, performedBy]
    expect(insertCall!.values[0]).toBe('issue-1');
    expect(insertCall!.values[1]).toBe('company-1');
    expect(insertCall!.values[3]).toBe('user-1'); // performed_by = issue creator (no system-user concept in this schema)
  });

  it('dedupes: skips an issue that already has an auto_warning activity within the last 24h', async () => {
    const { query, withTenant, calls } = makeQuery((text) => {
      if (text.includes('FROM issues')) {
        return [{ id: 'issue-1', companyId: 'company-1', createdBy: 'user-1', deadline: yesterday }];
      }
      if (text.includes('activity_type = \'auto_warning\'')) {
        return [{ id: 'existing-warning' }]; // already warned recently
      }
      return undefined;
    });
    const svc = new IssueWarningService({ query, withTenant } as unknown as DatabaseService);

    const result = await svc.checkOverdueIssues();

    expect(result).toEqual({ checked: 1, warned: 0, skipped: 1 });
    expect(calls.some(c => c.text.includes('INSERT INTO issue_activities'))).toBe(false);
  });

  it('is a no-op when there are no overdue issues', async () => {
    const { query, withTenant } = makeQuery(() => []);
    const svc = new IssueWarningService({ query, withTenant } as unknown as DatabaseService);

    const result = await svc.checkOverdueIssues();
    expect(result).toEqual({ checked: 0, warned: 0, skipped: 0 });
  });
});
