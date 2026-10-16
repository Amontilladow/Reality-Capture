import { NotFoundException } from '@nestjs/common';
import { SubmittalsService } from './submittals.service';
import type { DatabaseService } from '../../database/database.service';
import type { NotificationsService } from '../notifications/notifications.service';

function makeService(responder: (text: string, values: unknown[]) => unknown[] | undefined) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const query = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    calls.push({ text, values });
    return Promise.resolve(responder(text, values) ?? []);
  });
  const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
  const paginate = jest.fn((rows: unknown[], page: number, perPage: number) => ({
    data: rows, total: rows.length, page, perPage, totalPages: Math.ceil(rows.length / perPage) || 1,
  }));
  const db = { query, withTenant, paginate };
  const notifications = { create: jest.fn() };
  const svc = new SubmittalsService(db as unknown as DatabaseService, notifications as unknown as NotificationsService);
  return { svc, calls };
}

const companyId = 'company-1';
const projectId = 'project-1';

// Owner's org-category RBAC sprint, "critical" subcontractor isolation:
// one subcontractor account must never read another's submittals, even on
// the same project. Same pattern already proven for RFIs/Issues.
describe('SubmittalsService subcontractor isolation', () => {
  it('findAll: a non-subcontractor viewer is not isolated at all', async () => {
    const { svc, calls } = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [{ role: 'document_controller' }];
      if (text.includes('FROM submittals s')) return [{ id: 'sub-1', fullCount: '1' }];
      return undefined;
    });
    await svc.findAll(companyId, projectId, {}, 'viewer-1');
    const listCall = calls.find((c) => c.text.includes('FROM submittals s'));
    expect(listCall!.values).toContain(false);
  });

  it('findAll: a subcontractor viewer gets created_by scoped into the query', async () => {
    const { svc, calls } = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [{ role: 'subcontractor' }];
      if (text.includes('FROM submittals s')) return [{ id: 'sub-1', fullCount: '1' }];
      return undefined;
    });
    await svc.findAll(companyId, projectId, {}, 'sub-user-1');
    const listCall = calls.find((c) => c.text.includes('FROM submittals s'));
    expect(listCall!.values).toContain(true);
    expect(listCall!.values).toContain('sub-user-1');
  });

  it('findOne: a subcontractor viewer gets 404 reading a submittal they did not create', async () => {
    const { svc } = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [{ role: 'subcontractor' }];
      if (text.includes('FROM submittals s')) return [{ id: 'sub-1', createdBy: 'other-sub-user' }];
      return undefined;
    });
    await expect(svc.findOne(companyId, projectId, 'sub-1', 'sub-user-1')).rejects.toThrow('Submittal sub-1 not found.');
  });

  it('findOne: a subcontractor viewer CAN read their own submittal', async () => {
    const { svc } = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [{ role: 'subcontractor' }];
      if (text.includes('FROM submittals s')) return [{ id: 'sub-1', createdBy: 'sub-user-1' }];
      return undefined;
    });
    await expect(svc.findOne(companyId, projectId, 'sub-1', 'sub-user-1')).resolves.toMatchObject({ id: 'sub-1' });
  });

  it('findOne: an internal viewer reads any submittal regardless of who created it', async () => {
    const { svc } = makeService((text) => {
      if (text.includes('SELECT role FROM project_members')) return [{ role: 'document_controller' }];
      if (text.includes('FROM submittals s')) return [{ id: 'sub-1', createdBy: 'some-sub-user' }];
      return undefined;
    });
    await expect(svc.findOne(companyId, projectId, 'sub-1', 'internal-user-1')).resolves.toMatchObject({ id: 'sub-1' });
  });

  it('findOne: throws NotFoundException for a submittal that genuinely does not exist', async () => {
    const { svc } = makeService(() => []);
    await expect(svc.findOne(companyId, projectId, 'missing', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
