import { rankItems, scoreItem, dueState, classifyAttention, localNow, isValidTimeZone, type WorkItem } from './priority-rules';

const base: WorkItem = {
  source: 'issue', id: 'x', projectId: 'p', projectName: 'Tower', reference: 'ISS-1', title: 'Leak',
  status: 'open', priority: 'medium', dueDate: null, dueTime: null, relation: 'assigned',
};
const item = (o: Partial<WorkItem>): WorkItem => ({ ...base, ...o });
const TODAY = '2026-11-16';

describe('dueState', () => {
  it('is overdue for a past date, with whole days', () => {
    expect(dueState({ dueDate: '2026-11-14', dueTime: null }, TODAY, '09:00')).toEqual({ state: 'overdue', daysOverdue: 2 });
  });
  it('is overdue today once its time has passed', () => {
    expect(dueState({ dueDate: TODAY, dueTime: '08:00' }, TODAY, '09:00').state).toBe('overdue');
    expect(dueState({ dueDate: TODAY, dueTime: '11:00' }, TODAY, '09:00').state).toBe('today');
  });
  it('never calls an item without a due date overdue', () => {
    expect(dueState({ dueDate: null, dueTime: null }, TODAY, '23:59').state).toBe('none');
  });
  it('buckets tomorrow, this week and later', () => {
    expect(dueState({ dueDate: '2026-11-17', dueTime: null }, TODAY, '09:00').state).toBe('tomorrow');
    expect(dueState({ dueDate: '2026-11-23', dueTime: null }, TODAY, '09:00').state).toBe('this_week');
    expect(dueState({ dueDate: '2026-11-24', dueTime: null }, TODAY, '09:00').state).toBe('later');
  });
});

describe('rankItems', () => {
  it('puts overdue above due today, and critical above medium on the same day', () => {
    const ranked = rankItems([
      item({ id: 'today-med', dueDate: TODAY }),
      item({ id: 'overdue', dueDate: '2026-11-10' }),
      item({ id: 'today-crit', dueDate: TODAY, priority: 'critical' }),
      item({ id: 'undated' }),
    ], TODAY, '08:00');
    expect(ranked.map((r) => r.id)).toEqual(['overdue', 'today-crit', 'today-med', 'undated']);
  });
  it('does not rank everything equally: waiting on me adds weight', () => {
    const a = scoreItem(item({ source: 'rfi', relation: 'awaiting_response', dueDate: '2026-11-18' }), TODAY, '08:00');
    const b = scoreItem(item({ dueDate: '2026-11-18' }), TODAY, '08:00');
    expect(a.score).toBe(b.score + 15);
  });
  it('caps the overdue bonus at 30 days', () => {
    expect(scoreItem(item({ dueDate: '2026-01-01', priority: 'low' }), TODAY, '08:00').score).toBe(130);
  });
  it('breaks ties by the earlier due time', () => {
    const ranked = rankItems([item({ id: 'late', dueDate: TODAY, dueTime: '15:00' }), item({ id: 'early', dueDate: TODAY, dueTime: '11:00' })], TODAY, '08:00');
    expect(ranked.map((r) => r.id)).toEqual(['early', 'late']);
  });
  it('explains itself and suggests the next action', () => {
    const r = scoreItem(item({ source: 'rfi', relation: 'awaiting_response', dueDate: '2026-11-14', priority: 'high' }), TODAY, '08:00');
    expect(r.reason).toBe('High priority, overdue by 2 days, waiting on your answer');
    expect(r.nextAction).toBe('Write and send your answer');
  });
});

describe('classifyAttention', () => {
  it('needs a real past due date to be overdue', () => {
    expect(classifyAttention({ priority: 'high', dueDate: null }, TODAY)).toBe('pending');
    expect(classifyAttention({ priority: 'high', dueDate: '2026-11-15' }, TODAY)).toBe('overdue');
  });
  it('ranks critical first, then due within 3 days as due soon', () => {
    expect(classifyAttention({ priority: 'critical', dueDate: '2026-11-01' }, TODAY)).toBe('critical');
    expect(classifyAttention({ priority: 'low', dueDate: '2026-11-19' }, TODAY)).toBe('due_soon');
    expect(classifyAttention({ priority: 'low', dueDate: '2026-11-20' }, TODAY)).toBe('pending');
  });
  it('keeps informational items informational', () => {
    expect(classifyAttention({ priority: 'critical', dueDate: null, informational: true }, TODAY)).toBe('info');
  });
});

describe('time zones', () => {
  it('validates IANA zones', () => {
    expect(isValidTimeZone('Asia/Dubai')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
  it('gives the local date and time, across a date line and DST', () => {
    const at = new Date('2026-11-15T22:30:00Z');
    expect(localNow('Asia/Dubai', at)).toEqual({ today: '2026-11-16', time: '02:30' });
    expect(localNow('America/New_York', at)).toEqual({ today: '2026-11-15', time: '17:30' });
    // 2026-03-08 is the US DST start: 07:30Z is 03:30 EDT, not 02:30.
    expect(localNow('America/New_York', new Date('2026-03-08T07:30:00Z')).time).toBe('03:30');
  });
});
