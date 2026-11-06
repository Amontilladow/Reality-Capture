import { RiskController } from '../risk/risk.controller';
import { ReportsController } from '../reports/reports.controller';

// Same inlined metadata key as auth.controller.spec.ts (not exported from
// @nestjs/throttler's public entry point).
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';

// Every route that triggers a paid LLM call gets a tighter bucket than the
// 100 req/min app-wide default.
describe('AI route rate limits', () => {
  const routes: Array<[string, object]> = [
    ['risk briefing', RiskController.prototype.getAiBriefing],
    ['risk AI explanation', RiskController.prototype.getAiExplanation],
    ['reports briefing', ReportsController.prototype.getAiBriefing],
  ];

  it.each(routes)('%s is throttled at 10 req/min', (_name, handler) => {
    expect(Reflect.getMetadata(THROTTLER_LIMIT + 'default', handler)).toBe(10);
  });
});
