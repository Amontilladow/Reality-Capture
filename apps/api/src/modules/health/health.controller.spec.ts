import { HealthController } from './health.controller';
import type { DatabaseService } from '../../database/database.service';
import type { StorageService } from '../storage/storage.service';
import type { Queue } from 'bull';

// The readiness check's whole point is to not let one dependency's failure
// look like the others' -- each of database/redis/objectStorage is checked
// independently and reported independently, with a top-level "degraded"
// status when any of them is down. The liveness check (`check()`) stays a
// plain DB ping, unchanged from before this pass -- it's what render.yaml's
// healthCheckPath actually gates deploys/restarts on, so it deliberately
// does not depend on Redis/storage (see health.controller.ts's comment).
describe('HealthController', () => {
  function makeController(opts: {
    dbOk: boolean;
    redisOk: boolean | 'throws';
    storageOk: boolean | 'throws';
  }) {
    const db = { ping: jest.fn().mockResolvedValue(opts.dbOk) };
    const storage = {
      checkConnectivity: opts.storageOk === 'throws'
        ? jest.fn().mockRejectedValue(new Error('R2 unreachable'))
        : jest.fn().mockResolvedValue(opts.storageOk),
    };
    const queue = {
      client: {
        ping: opts.redisOk === 'throws'
          ? jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))
          : jest.fn().mockResolvedValue(opts.redisOk ? 'PONG' : 'not-pong'),
      },
    };

    return new HealthController(
      db as unknown as DatabaseService,
      storage as unknown as StorageService,
      queue as unknown as Queue,
    );
  }

  describe('check() -- liveness', () => {
    it('reports ok when the database is reachable', async () => {
      const controller = makeController({ dbOk: true, redisOk: true, storageOk: true });
      const result = await controller.check();
      expect(result.status).toBe('ok');
      expect(result.services).toEqual({ database: 'ok' });
    });

    it('reports degraded when the database is unreachable, and checks nothing else', async () => {
      const controller = makeController({ dbOk: false, redisOk: true, storageOk: true });
      const result = await controller.check();
      expect(result.status).toBe('degraded');
      expect(result.services).toEqual({ database: 'error' });
      // Liveness must not touch Redis/storage at all -- confirm the shape has no other keys.
      expect(Object.keys(result.services)).toEqual(['database']);
    });
  });

  describe('ready() -- readiness', () => {
    it('reports ok when every dependency is reachable', async () => {
      const controller = makeController({ dbOk: true, redisOk: true, storageOk: true });
      const result = await controller.ready();
      expect(result.status).toBe('ok');
      expect(result.services).toEqual({ database: 'ok', redis: 'ok', objectStorage: 'ok' });
    });

    it('reports degraded and pinpoints Redis when only Redis is down', async () => {
      const controller = makeController({ dbOk: true, redisOk: false, storageOk: true });
      const result = await controller.ready();
      expect(result.status).toBe('degraded');
      expect(result.services).toEqual({ database: 'ok', redis: 'error', objectStorage: 'ok' });
    });

    it('reports degraded when the Redis ping throws outright, without failing the whole request', async () => {
      const controller = makeController({ dbOk: true, redisOk: 'throws', storageOk: true });
      const result = await controller.ready();
      expect(result.status).toBe('degraded');
      expect(result.services.redis).toBe('error');
      expect(result.services.database).toBe('ok');
    });

    it('reports degraded and pinpoints object storage when only storage is unreachable', async () => {
      const controller = makeController({ dbOk: true, redisOk: true, storageOk: 'throws' });
      const result = await controller.ready();
      expect(result.status).toBe('degraded');
      expect(result.services).toEqual({ database: 'ok', redis: 'ok', objectStorage: 'error' });
    });

    it('reports every dependency independently when all three are down', async () => {
      const controller = makeController({ dbOk: false, redisOk: false, storageOk: false });
      const result = await controller.ready();
      expect(result.status).toBe('degraded');
      expect(result.services).toEqual({ database: 'error', redis: 'error', objectStorage: 'error' });
    });
  });
});
