import { TeamService } from './team.service';
import type { DatabaseService } from '../../../database/database.service';

function makeService(sqlMock: jest.Mock) {
  const db = { withTenant: jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(sqlMock)) };
  return new TeamService(db as unknown as DatabaseService);
}

describe('TeamService.getMyTeam', () => {
  it('returns an empty list for an individual contributor with no reports, without a second query', async () => {
    const sqlMock = jest.fn().mockResolvedValueOnce([]); // resolveDownlineUserIds -> no rows
    const svc = makeService(sqlMock);

    const team = await svc.getMyTeam('company-1', 'ic-1');

    expect(team).toEqual([]);
    expect(sqlMock).toHaveBeenCalledTimes(1); // never queries `users` when the downline is empty
  });

  it("maps a manager's downline to {userId, name, companyRole}", async () => {
    const sqlMock = jest.fn()
      .mockResolvedValueOnce([{ userId: 'user-b' }, { userId: 'user-c' }]) // resolveDownlineUserIds
      .mockResolvedValueOnce([
        { id: 'user-b', firstName: 'Bea', lastName: 'Draftsman', companyRole: 'consultant' },
        { id: 'user-c', firstName: 'Cy', lastName: 'Draftsman', companyRole: 'consultant' },
      ]);
    const svc = makeService(sqlMock);

    const team = await svc.getMyTeam('company-1', 'manager-a');

    expect(team).toEqual([
      { userId: 'user-b', name: 'Bea Draftsman', companyRole: 'consultant' },
      { userId: 'user-c', name: 'Cy Draftsman', companyRole: 'consultant' },
    ]);
  });
});
