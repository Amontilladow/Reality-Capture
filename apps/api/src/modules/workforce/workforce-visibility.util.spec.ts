import { ForbiddenException } from '@nestjs/common';
import type { TransactionSql } from 'postgres';
import {
  canViewUserActivity, resolveDownlineUserIds, resolveVisibleTargetUserId, LEADERSHIP_OVERRIDE_ROLE,
} from './workforce-visibility.util';
import type { DatabaseService } from '../../database/database.service';

const companyId = 'company-1';

function makeDb(sqlMock: jest.Mock) {
  return { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) } as unknown as DatabaseService;
}

// Simulates the WITH RECURSIVE downline CTE by actually walking the given
// manager_id -> user_id edge list in JS (BFS from viewerId), rather than
// returning a canned response -- this is what lets these tests genuinely
// exercise multi-level resolution against the acceptance test's
// A manages B, B manages C chain, without a real Postgres instance
// available in this sandbox to run the real recursive SQL against.
function makeGraphSql(edges: { userId: string; managerId: string }[]) {
  return jest.fn(async (_strings: TemplateStringsArray, viewerId: string) => {
    const result: string[] = [];
    const queue = [viewerId];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const edge of edges) {
        if (edge.managerId === current && !seen.has(edge.userId)) {
          seen.add(edge.userId);
          result.push(edge.userId);
          queue.push(edge.userId);
        }
      }
    }
    return result.map(userId => ({ userId }));
  });
}

describe('resolveDownlineUserIds (three-level chain: A manages B, B manages C)', () => {
  const edges = [{ userId: 'B', managerId: 'A' }, { userId: 'C', managerId: 'B' }];

  it("resolves A's downline to [B, C] -- transitive, not just the direct report", async () => {
    const sql = makeGraphSql(edges);
    const downline = await resolveDownlineUserIds(sql as unknown as TransactionSql, 'A');
    expect(downline.sort()).toEqual(['B', 'C']);
  });

  it("resolves B's downline to [C] only -- a manager doesn't see up the chain to A", async () => {
    const sql = makeGraphSql(edges);
    const downline = await resolveDownlineUserIds(sql as unknown as TransactionSql, 'B');
    expect(downline).toEqual(['C']);
  });

  it("resolves C's downline to [] -- an individual contributor with no reports", async () => {
    const sql = makeGraphSql(edges);
    const downline = await resolveDownlineUserIds(sql as unknown as TransactionSql, 'C');
    expect(downline).toEqual([]);
  });
});

describe('canViewUserActivity', () => {
  it('allows self-view without ever touching the database', async () => {
    const db = { withTenant: jest.fn() } as unknown as DatabaseService;
    const allowed = await canViewUserActivity(db, companyId, 'user-1', 'client_representative', 'user-1');
    expect(allowed).toBe(true);
    expect(db.withTenant).not.toHaveBeenCalled();
  });

  it(`allows a viewer at or above the ${LEADERSHIP_OVERRIDE_ROLE} weight to see anyone, without a reporting-line row`, async () => {
    const db = { withTenant: jest.fn() } as unknown as DatabaseService;
    const allowed = await canViewUserActivity(db, companyId, 'leader-1', 'company_admin', 'stranger-1');
    expect(allowed).toBe(true);
    expect(db.withTenant).not.toHaveBeenCalled(); // weight check short-circuits before any query
  });

  it('allows a manager below the leadership weight to view someone in their downward closure', async () => {
    const sql = makeGraphSql([{ userId: 'B', managerId: 'A' }, { userId: 'C', managerId: 'B' }]);
    const db = makeDb(sql);
    // 'engineering_manager' viewer role but checking against a lower-weight
    // scenario would short-circuit -- use a role below the override so the
    // reporting-line path is actually exercised.
    const allowed = await canViewUserActivity(db, companyId, 'A', 'project_manager', 'C');
    expect(allowed).toBe(true);
  });

  it('forbids a viewer below the leadership weight from seeing someone outside their downward closure', async () => {
    const sql = makeGraphSql([{ userId: 'B', managerId: 'A' }, { userId: 'C', managerId: 'B' }]);
    const db = makeDb(sql);
    const allowed = await canViewUserActivity(db, companyId, 'B', 'project_manager', 'A');
    expect(allowed).toBe(false); // B doesn't see up the chain to A
  });
});

describe('resolveVisibleTargetUserId', () => {
  it('returns the caller unchanged, without a database call, when no target is given', async () => {
    const db = { withTenant: jest.fn() } as unknown as DatabaseService;
    const userId = await resolveVisibleTargetUserId(db, companyId, 'caller-1', 'client_representative', undefined);
    expect(userId).toBe('caller-1');
    expect(db.withTenant).not.toHaveBeenCalled();
  });

  it('returns the target when the caller is allowed to view them', async () => {
    const sql = makeGraphSql([{ userId: 'B', managerId: 'A' }]);
    const db = makeDb(sql);
    const userId = await resolveVisibleTargetUserId(db, companyId, 'A', 'project_manager', 'B');
    expect(userId).toBe('B');
  });

  it('throws ForbiddenException when the caller is not allowed to view the target', async () => {
    const sql = makeGraphSql([{ userId: 'B', managerId: 'A' }]);
    const db = makeDb(sql);
    await expect(resolveVisibleTargetUserId(db, companyId, 'someone-else', 'project_manager', 'B')).rejects.toThrow(ForbiddenException);
  });
});
