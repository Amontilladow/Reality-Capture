import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
@SkipThrottle({ default: true, auth: true })
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    // Reuses the same Bull-managed Redis connection the image-processing
    // queue already holds open, rather than opening a second one just to
    // ping it.
    @InjectQueue('image-processing') private readonly queue: Queue,
  ) {}

  // Liveness: is the process up at all. Deliberately checks nothing else --
  // this is the path Render's render.yaml `healthCheckPath` actually points
  // at today, and it gates whether a fresh deploy is allowed to take traffic
  // and whether a running instance gets restarted. Making it depend on
  // Redis/object-storage reachability would mean a brief, unrelated Redis or
  // R2 blip could get a perfectly healthy API instance killed -- so this
  // stays a plain DB ping, exactly its existing behavior.
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness check — used by the load balancer / deploy health check' })
  async check() {
    const dbOk = await this.db.ping();
    const status = dbOk ? 'ok' : 'degraded';
    return {
      status,
      timestamp: new Date().toISOString(),
      services: { database: dbOk ? 'ok' : 'error' },
    };
  }

  // Readiness: are this instance's actual required dependencies reachable --
  // database, Redis (the job queue), and object storage. Not currently wired
  // into Render's deploy/restart gate (see render.yaml's single
  // healthCheckPath, still pointed at the liveness check above) -- that's a
  // deliberate choice, not an oversight: promoting this to the deploy gate
  // is a real production-behavior change that needs its own deliberate
  // decision once the on-call/monitoring story exists. This endpoint exists
  // today to back a monitoring/alerting dashboard (see LAUNCH_READINESS.md).
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness check — database, Redis, and object storage reachability' })
  async ready() {
    const [dbOk, redisOk, storageOk] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkStorage(),
    ]);

    const services = {
      database: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
      objectStorage: storageOk ? 'ok' : 'error',
    } as const;

    return {
      status: dbOk && redisOk && storageOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services,
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      return await this.db.ping();
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      const pong = await this.queue.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  private async checkStorage(): Promise<boolean> {
    try {
      return await this.storage.checkConnectivity();
    } catch {
      return false;
    }
  }
}
