import { OrgCategoryPermissionService } from './org-category-permission.service';
import type { DatabaseService } from '../../database/database.service';

function makeQuery(responder: (text: string) => unknown[] | undefined) {
  return jest.fn((strings: TemplateStringsArray) => {
    const text = strings.join('?');
    return Promise.resolve(responder(text) ?? []);
  });
}

function makeService(responder: (text: string) => unknown[] | undefined) {
  const query = makeQuery(responder);
  const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
  const db = { withTenant };
  return new OrgCategoryPermissionService(db as unknown as DatabaseService);
}

const companyId = 'company-1';
const userId = 'user-1';
const projectId = 'project-1';

describe('OrgCategoryPermissionService.canPerformAction', () => {
  it('super_admin always passes, with no query at all', async () => {
    const svc = makeService(() => { throw new Error('should not query for super_admin'); });
    const user = { companyId, companyRole: 'super_admin' as const, id: userId };
    await expect(svc.canPerformAction(user, projectId, 'rfis', 'edit')).resolves.toBe(true);
  });

  it('engineering_manager always passes every module/action, with no query at all', async () => {
    const svc = makeService(() => { throw new Error('should not query for engineering_manager'); });
    const user = { companyId, companyRole: 'engineering_manager' as const, id: userId };
    await expect(svc.canPerformAction(user, projectId, 'drawings', 'close')).resolves.toBe(true);
    await expect(svc.canPerformAction(user, projectId, 'qaqc_checklists', 'approve')).resolves.toBe(true);
  });

  it("the project's own project_lead passes regardless of category", async () => {
    const svc = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [{ role: 'project_lead' }];
      return undefined;
    });
    // client_representative -> 'view_only' category, which has no 'edit' --
    // project_lead still bypasses it.
    const user = { companyId, companyRole: 'client_representative' as const, id: userId };
    await expect(svc.canPerformAction(user, projectId, 'rfis', 'edit')).resolves.toBe(true);
  });

  it('defers (returns true, i.e. does not block) for a subcontractor project member -- SubcontractorRfiAccessGuard decides', async () => {
    const svc = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [{ role: 'subcontractor' }];
      return undefined;
    });
    const user = { companyId, companyRole: 'client_representative' as const, id: userId };
    await expect(svc.canPerformAction(user, projectId, 'bim', 'create')).resolves.toBe(true);
  });

  it("construction_team (project_manager) gets create/view/edit on rfis, matching the owner's matrix", async () => {
    const svc = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [];
      return undefined;
    });
    const user = { companyId, companyRole: 'project_manager' as const, id: userId };
    await expect(svc.canPerformAction(user, projectId, 'rfis', 'create')).resolves.toBe(true);
    await expect(svc.canPerformAction(user, projectId, 'rfis', 'view')).resolves.toBe(true);
    await expect(svc.canPerformAction(user, projectId, 'rfis', 'edit')).resolves.toBe(true);
    // Not granted 'approve' or 'close' on rfis per the matrix.
    await expect(svc.canPerformAction(user, projectId, 'rfis', 'approve')).resolves.toBe(false);
    await expect(svc.canPerformAction(user, projectId, 'rfis', 'close')).resolves.toBe(false);
  });

  it("management (company_admin) is view-only on rfis/drawings/bim, not create/edit/approve/close", async () => {
    const svc = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [];
      return undefined;
    });
    const user = { companyId, companyRole: 'company_admin' as const, id: userId };
    await expect(svc.canPerformAction(user, projectId, 'rfis', 'view')).resolves.toBe(true);
    await expect(svc.canPerformAction(user, projectId, 'rfis', 'create')).resolves.toBe(false);
    await expect(svc.canPerformAction(user, projectId, 'drawings', 'edit')).resolves.toBe(false);
    await expect(svc.canPerformAction(user, projectId, 'bim', 'approve')).resolves.toBe(false);
  });

  it("qaqc_team (qa_qc_manager) gets full create/view/edit/approve/close on issues_snags and qaqc_checklists", async () => {
    const svc = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [];
      return undefined;
    });
    const user = { companyId, companyRole: 'qa_qc_manager' as const, id: userId };
    for (const action of ['create', 'view', 'edit', 'approve', 'close'] as const) {
      await expect(svc.canPerformAction(user, projectId, 'issues_snags', action)).resolves.toBe(true);
      await expect(svc.canPerformAction(user, projectId, 'qaqc_checklists', action)).resolves.toBe(true);
    }
  });

  it("view_only (client_representative, the signup default) only ever gets 'view', on every module", async () => {
    const svc = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [];
      return undefined;
    });
    const user = { companyId, companyRole: 'client_representative' as const, id: userId };
    for (const orgModule of ['rfis', 'drawings', 'issues_snags', 'bim', 'qaqc_checklists', 'document_approvals'] as const) {
      await expect(svc.canPerformAction(user, projectId, orgModule, 'view')).resolves.toBe(true);
      await expect(svc.canPerformAction(user, projectId, orgModule, 'create')).resolves.toBe(false);
    }
  });

  it('technical_director maps to engineering_team (Technical Manager match), not management', async () => {
    const svc = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [];
      return undefined;
    });
    const user = { companyId, companyRole: 'technical_director' as const, id: userId };
    // engineering_team gets create/view/edit/approve on BIM; management only gets view.
    await expect(svc.canPerformAction(user, projectId, 'bim', 'create')).resolves.toBe(true);
  });

  it('document_control (project_document_controller) gets create/view/close on rfis, not edit', async () => {
    const svc = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [];
      return undefined;
    });
    const user = { companyId, companyRole: 'project_document_controller' as const, id: userId };
    await expect(svc.canPerformAction(user, projectId, 'rfis', 'create')).resolves.toBe(true);
    await expect(svc.canPerformAction(user, projectId, 'rfis', 'close')).resolves.toBe(true);
    await expect(svc.canPerformAction(user, projectId, 'rfis', 'edit')).resolves.toBe(false);
  });
});
