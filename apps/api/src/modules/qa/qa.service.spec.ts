import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { QaService } from './qa.service';
import type { DatabaseService } from '../../database/database.service';

function makeService(responder: (text: string) => unknown[] | undefined) {
  const query = jest.fn((strings: TemplateStringsArray) => Promise.resolve(responder(strings.join('?')) ?? []));
  const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
  const paginate = jest.fn((rows: unknown[], page: number, perPage: number) => ({
    data: rows, total: rows.length, page, perPage, totalPages: Math.ceil(rows.length / perPage) || 1,
  }));
  const db = { query, withTenant, paginate };
  const svc = new QaService(db as unknown as DatabaseService);
  return { svc, query };
}

const companyId = 'company-1';
const projectId = 'project-1';
const inspectionId = 'inspection-1';

describe('QaService.update -- owner\'s org-category RBAC sprint item-scoping', () => {
  function existingRow(overrides: Record<string, unknown> = {}) {
    return { id: inspectionId, companyId, projectId, status: 'scheduled', assignedTo: 'user-assigned', ...overrides };
  }

  it('Construction Team can edit an inspection assigned to them', async () => {
    const { svc } = makeService((text) => {
      if (text.includes('FROM qa_inspections q')) return [existingRow({ assignedTo: 'user-1' })];
      if (text.includes('UPDATE qa_inspections')) return [{ id: inspectionId, status: 'passed' }];
      return undefined;
    });
    await expect(
      svc.update(companyId, projectId, inspectionId, 'user-1', { status: 'passed' }, 'construction_manager'),
    ).resolves.toMatchObject({ status: 'passed' });
  });

  it('Construction Team is blocked from editing an inspection assigned to someone else', async () => {
    const { svc, query } = makeService((text) => {
      if (text.includes('FROM qa_inspections q')) return [existingRow({ assignedTo: 'someone-else' })];
      return undefined;
    });
    await expect(
      svc.update(companyId, projectId, inspectionId, 'user-1', { status: 'passed' }, 'construction_manager'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Only findOne()'s own SELECT ran -- no UPDATE was attempted.
    expect(query).not.toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('UPDATE')]));
  });

  it('QAQC Team can edit any inspection regardless of assignment', async () => {
    const { svc } = makeService((text) => {
      if (text.includes('FROM qa_inspections q')) return [existingRow({ assignedTo: 'someone-else' })];
      if (text.includes('UPDATE qa_inspections')) return [{ id: inspectionId, status: 'passed' }];
      return undefined;
    });
    await expect(
      svc.update(companyId, projectId, inspectionId, 'user-qa', { status: 'passed' }, 'qa_qc_manager'),
    ).resolves.toMatchObject({ status: 'passed' });
  });

  it('with no userRole passed (every pre-existing internal caller), the assignment check never applies', async () => {
    const { svc } = makeService((text) => {
      if (text.includes('FROM qa_inspections q')) return [existingRow({ assignedTo: 'someone-else' })];
      if (text.includes('UPDATE qa_inspections')) return [{ id: inspectionId, status: 'passed' }];
      return undefined;
    });
    await expect(
      svc.update(companyId, projectId, inspectionId, 'user-1', { status: 'passed' }),
    ).resolves.toMatchObject({ status: 'passed' });
  });

  it('throws NotFoundException for an inspection that does not exist under this company/project', async () => {
    const { svc } = makeService(() => []);
    await expect(
      svc.update(companyId, projectId, inspectionId, 'user-1', { status: 'passed' }, 'construction_manager'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
