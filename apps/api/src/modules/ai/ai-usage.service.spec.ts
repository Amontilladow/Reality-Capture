import type { ConfigService } from '@nestjs/config';
import type { DatabaseService } from '../../database/database.service';

// Spec section 13: a domain-guard-blocked question must never call Redis at
// all (AiService.ask() returns before checkAndReserve() is reached), so
// these tests only cover checkAndReserve()/getRemaining()'s own daily and
// per-minute enforcement -- the "blocked doesn't consume quota" guarantee
// itself is covered in ai.service.spec.ts, where it's actually observable.
const incrMock = jest.fn();
const decrMock = jest.fn();
const expireMock = jest.fn();
const getMock = jest.fn();

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({
  incr: incrMock, decr: decrMock, expire: expireMock, get: getMock,
  on: jest.fn(), disconnect: jest.fn(),
})));

import { AiUsageService } from './ai-usage.service';

describe('AiUsageService', () => {
  const roleLimits = { consultant: { dailyLimit: 30, perMinuteLimit: 10 }, default: { dailyLimit: 20, perMinuteLimit: 5 } };

  function makeService() {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'ai.roleLimits') return roleLimits;
        if (key === 'redis.host') return 'localhost';
        if (key === 'redis.port') return 6379;
        return undefined;
      }),
    };
    const db = { withTenant: jest.fn().mockResolvedValue(undefined) };
    const svc = new AiUsageService(config as unknown as ConfigService, db as unknown as DatabaseService);
    return { svc, db };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows a request within both the daily and per-minute limits', async () => {
    const { svc } = makeService();
    incrMock.mockResolvedValueOnce(5).mockResolvedValueOnce(2); // day count, minute count
    const result = await svc.checkAndReserve('user-1', 'consultant');
    expect(result).toEqual({ allowed: true, dailyUsed: 5, dailyLimit: 30 });
  });

  it('rejects once the daily limit is exceeded, without touching the per-minute counter', async () => {
    const { svc } = makeService();
    incrMock.mockResolvedValueOnce(31); // over the 30/day limit for consultant
    const result = await svc.checkAndReserve('user-1', 'consultant');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_limit');
    expect(decrMock).toHaveBeenCalledTimes(1); // the daily reservation is rolled back
    expect(incrMock).toHaveBeenCalledTimes(1); // never reached the per-minute incr
  });

  it('rejects once the per-minute limit is exceeded and rolls back both counters', async () => {
    const { svc } = makeService();
    incrMock.mockResolvedValueOnce(6).mockResolvedValueOnce(11); // under daily, over 10/min
    const result = await svc.checkAndReserve('user-1', 'consultant');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('rate_limit');
    expect(decrMock).toHaveBeenCalledTimes(2); // both day and minute reservations rolled back
  });

  it('falls back to the default role bucket for an unlisted role', async () => {
    const { svc } = makeService();
    incrMock.mockResolvedValueOnce(21); // over the default 20/day limit
    const result = await svc.checkAndReserve('user-1', 'some_unlisted_role');
    expect(result.allowed).toBe(false);
    expect(result.dailyLimit).toBe(20);
  });

  it('writes a fire-and-forget log entry without throwing when the DB write fails', () => {
    const { svc, db } = makeService();
    (db.withTenant as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    expect(() => svc.log({ companyId: 'c1', userId: 'u1', userRole: 'consultant', status: 'allowed' })).not.toThrow();
  });
});
