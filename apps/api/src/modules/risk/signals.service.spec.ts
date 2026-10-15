import { SignalsService } from './signals.service';
import type { DatabaseService } from '../../database/database.service';

// Regression test for a real production bug: qaqc_records.record_type is a
// plain VARCHAR(10) (migration 067), while risk_graph_nodes.node_type is the
// risk_node_type enum (migration 050) -- joining them without an explicit
// cast throws "operator does not exist: risk_node_type = character varying"
// on EVERY call, which went undetected by the mocked unit tests elsewhere in
// this module (they never execute against a real Postgres engine) and
// silently broke risk recalculation project-wide -- not just for QAQC, but
// for every entity type, since detectSignalsForProject() runs every
// detector in one sequence and this one threw unconditionally, aborting
// whatever recalculateForEntity()/recalculateForNode() call was in
// progress. Confirmed live via Render logs before this fix.
describe('SignalsService.detectQaqcSignals', () => {
  it("casts qaqc_records.record_type to risk_node_type in the risk_graph_nodes join, so the enum/varchar comparison doesn't throw", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const withTenant = jest.fn((_companyId: string, fn: (sql: unknown) => unknown) => fn(query));
    const db = { withTenant } as unknown as DatabaseService;
    const svc = new SignalsService(db);

    await svc.detectQaqcSignals('company-1', 'project-1');

    const sql = (query.mock.calls[0][0] as TemplateStringsArray).join('');
    expect(sql).toContain('n.node_type = q.record_type::risk_node_type');
  });
});
