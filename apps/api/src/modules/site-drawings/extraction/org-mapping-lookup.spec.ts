import { resolveOrgMapping } from './org-mapping-lookup';
import type { TransactionSql } from 'postgres';

function fakeSql(rows: unknown[]): TransactionSql {
  return (() => Promise.resolve(rows)) as unknown as TransactionSql;
}

describe('resolveOrgMapping', () => {
  const projectId = 'project-1';

  it('returns nothing when no mapping matches', async () => {
    const sql = fakeSql([{ pattern: 'S-', organizationName: 'Structural Co', role: 'originator' }]);
    const result = await resolveOrgMapping(sql, projectId, 'A-101');
    expect(result).toEqual({ originator: undefined, responsibleSubcontractor: undefined });
  });

  it('matches a prefix case-insensitively', async () => {
    const sql = fakeSql([{ pattern: 's-', organizationName: 'Structural Co', role: 'originator' }]);
    const result = await resolveOrgMapping(sql, projectId, 'S-101');
    expect(result.originator).toBe('Structural Co');
  });

  it('resolves both originator and subcontractor independently when both roles have a matching pattern', async () => {
    const sql = fakeSql([
      { pattern: 'MEP-', organizationName: 'Consulting Engineers', role: 'originator' },
      { pattern: 'MEP-', organizationName: 'Acme MEP Contracting', role: 'subcontractor' },
    ]);
    const result = await resolveOrgMapping(sql, projectId, 'MEP-204');
    expect(result.originator).toBe('Consulting Engineers');
    expect(result.responsibleSubcontractor).toBe('Acme MEP Contracting');
  });

  it('prefers the longest matching pattern when more than one applies', async () => {
    const sql = fakeSql([
      { pattern: 'S-', organizationName: 'Generic Structural', role: 'originator' },
      { pattern: 'S-ACME-', organizationName: 'Acme Structural', role: 'originator' },
    ]);
    const result = await resolveOrgMapping(sql, projectId, 'S-ACME-042');
    expect(result.originator).toBe('Acme Structural');
  });
});
