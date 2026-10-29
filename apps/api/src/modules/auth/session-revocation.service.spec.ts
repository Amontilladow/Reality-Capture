import type { ConfigService } from '@nestjs/config';

// Same jest.mock('ioredis', ...) convention as ai-usage.service.spec.ts
// (this service's own sibling Redis consumer) -- see that file's comment
// for the full rationale.
const setMock = jest.fn();
const existsMock = jest.fn();

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({
  set: setMock, exists: existsMock, on: jest.fn(), disconnect: jest.fn(),
})));

import { SessionRevocationService } from './session-revocation.service';

describe('SessionRevocationService', () => {
  function makeService(accessExpiresIn = '15m') {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'jwt.accessExpiresIn') return accessExpiresIn;
        if (key === 'redis.host') return 'localhost';
        if (key === 'redis.port') return 6379;
        return undefined;
      }),
    };
    const svc = new SessionRevocationService(config as unknown as ConfigService);
    return { svc };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Initial authorization / denial write.
  it('denyFutureAccess sets a Redis key for the user with a TTL of the access-token lifetime plus a 60s safety margin', async () => {
    const { svc } = makeService('15m');

    await svc.denyFutureAccess('user-1');

    expect(setMock).toHaveBeenCalledWith('auth:deactivated:user-1', '1', 'PX', 15 * 60_000 + 60_000);
  });

  it('denyFutureAccess parses a differently-configured access-token lifetime correctly', async () => {
    const { svc } = makeService('1h');

    await svc.denyFutureAccess('user-2');

    expect(setMock).toHaveBeenCalledWith('auth:deactivated:user-2', '1', 'PX', 60 * 60_000 + 60_000);
  });

  // Normal read path.
  it('isDenied returns true when the deny-list key exists', async () => {
    const { svc } = makeService();
    existsMock.mockResolvedValueOnce(1);

    await expect(svc.isDenied('user-1')).resolves.toBe(true);
    expect(existsMock).toHaveBeenCalledWith('auth:deactivated:user-1');
  });

  it('isDenied returns false when the deny-list key does not exist', async () => {
    const { svc } = makeService();
    existsMock.mockResolvedValueOnce(0);

    await expect(svc.isDenied('user-1')).resolves.toBe(false);
  });

  // Failure handling: a Redis outage must fail OPEN on this read path, not
  // lock every user in the app out on a transient infra blip.
  it('isDenied fails open (returns false) when Redis throws', async () => {
    const { svc } = makeService();
    existsMock.mockRejectedValueOnce(new Error('connection refused'));

    await expect(svc.isDenied('user-1')).resolves.toBe(false);
  });
});
