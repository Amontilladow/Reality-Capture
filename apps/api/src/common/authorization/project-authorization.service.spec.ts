import { ProjectAuthorizationService } from './project-authorization.service';
import type { DatabaseService } from '../../database/database.service';

function makeQuery(responder: (text: string, values: unknown[]) => unknown[] | undefined) {
  const query = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    return Promise.resolve(responder(text, values) ?? []);
  });
  return query;
}

function makeService(responder: (text: string, values: unknown[]) => unknown[] | undefined) {
  const query = makeQuery(responder);
  const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
  const db = { withTenant };
  return new ProjectAuthorizationService(db as unknown as DatabaseService);
}

describe('ProjectAuthorizationService.hasProjectPermission', () => {
  const companyId = 'company-1';
  const userId = 'user-1';
  const projectId = 'project-1';

  it('super_admin always passes, with no query at all', async () => {
    const svc = makeService(() => {
      throw new Error('should not query for super_admin');
    });
    await expect(svc.hasProjectPermission(companyId, 'super_admin', userId, projectId, 'manage_rfis')).resolves.toBe(true);
  });

  it("the project's own project_lead passes, without needing a grant", async () => {
    const svc = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [{ role: 'project_lead' }];
      if (text.includes('SELECT id FROM project_permission_grants')) return [];
      return undefined;
    });
    await expect(svc.hasProjectPermission(companyId, 'member', userId, projectId, 'manage_rfis')).resolves.toBe(true);
  });

  it('a non-lead member with a matching grant passes', async () => {
    const svc = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [{ role: 'site_engineer' }];
      if (text.includes('SELECT id FROM project_permission_grants')) return [{ id: 'grant-1' }];
      return undefined;
    });
    await expect(svc.hasProjectPermission(companyId, 'member', userId, projectId, 'manage_rfis')).resolves.toBe(true);
  });

  it('a non-lead member with no grant is denied', async () => {
    const svc = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [{ role: 'site_engineer' }];
      if (text.includes('SELECT id FROM project_permission_grants')) return [];
      return undefined;
    });
    await expect(svc.hasProjectPermission(companyId, 'member', userId, projectId, 'manage_rfis')).resolves.toBe(false);
  });

  it('a non-member (no project_members row at all) with no grant is denied', async () => {
    const svc = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [];
      if (text.includes('SELECT id FROM project_permission_grants')) return [];
      return undefined;
    });
    await expect(svc.hasProjectPermission(companyId, 'member', userId, projectId, 'manage_rfis')).resolves.toBe(false);
  });

  it('checks the grant for the exact permission requested, not any permission', async () => {
    const svc = makeService((text, values) => {
      if (text.includes('SELECT role FROM project_members')) return [{ role: 'site_engineer' }];
      if (text.includes('SELECT id FROM project_permission_grants')) {
        // Only a 'manage_issues' grant exists -- 'manage_rfis' should still be denied.
        return values.includes('manage_issues') ? [{ id: 'grant-1' }] : [];
      }
      return undefined;
    });
    await expect(svc.hasProjectPermission(companyId, 'member', userId, projectId, 'manage_rfis')).resolves.toBe(false);
    await expect(svc.hasProjectPermission(companyId, 'member', userId, projectId, 'manage_issues')).resolves.toBe(true);
  });
});
