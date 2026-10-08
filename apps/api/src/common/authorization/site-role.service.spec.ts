import { SiteRoleService } from './site-role.service';
import type { DatabaseService } from '../../database/database.service';

function makeService(memberRows: Array<{ role: string }>) {
  const withTenant = jest.fn().mockImplementation(async (_companyId: string, fn: (sql: unknown) => unknown) => {
    // withTenant hands the callback a tagged-template `sql` function; the
    // real implementation doesn't matter here, only that calling it
    // resolves to the configured rows.
    return fn((() => Promise.resolve(memberRows)) as never);
  });
  const db = { withTenant } as unknown as DatabaseService;
  return { service: new SiteRoleService(db), withTenant };
}

describe('SiteRoleService.isRestricted', () => {
  const user = { companyId: 'company-1', id: 'user-1' };

  it('restricts construction_manager on every request, with no DB lookup', async () => {
    const { service, withTenant } = makeService([]);
    await expect(service.isRestricted({ ...user, companyRole: 'construction_manager' }, 'project-1')).resolves.toBe(true);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('restricts project_engineer on every request, with no DB lookup', async () => {
    const { service, withTenant } = makeService([]);
    await expect(service.isRestricted({ ...user, companyRole: 'project_engineer' }, 'project-1')).resolves.toBe(true);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('restricts construction_manager even with no project in the request', async () => {
    const { service } = makeService([]);
    await expect(service.isRestricted({ ...user, companyRole: 'construction_manager' }, undefined)).resolves.toBe(true);
  });

  it('does not restrict an ordinary company role with no matching project membership', async () => {
    const { service } = makeService([{ role: 'surveyor' }]);
    await expect(service.isRestricted({ ...user, companyRole: 'project_manager' }, 'project-1')).resolves.toBe(false);
  });

  it('restricts a site_engineer project member within that specific project', async () => {
    const { service } = makeService([{ role: 'site_engineer' }]);
    await expect(service.isRestricted({ ...user, companyRole: 'project_manager' }, 'project-1')).resolves.toBe(true);
  });

  it('does not restrict company-wide routes with no project in the URL, even for a site_engineer elsewhere', async () => {
    const { service, withTenant } = makeService([{ role: 'site_engineer' }]);
    await expect(service.isRestricted({ ...user, companyRole: 'project_manager' }, undefined)).resolves.toBe(false);
    expect(withTenant).not.toHaveBeenCalled();
  });
});
