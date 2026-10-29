import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import ms from 'ms';

// M-1 fix (KNOWN_ISSUES_AND_REMEDIATION.md): deactivating a user correctly
// revoked their refresh tokens, but JwtStrategy.validate() did no DB/cache
// lookup at all -- an already-issued access token stayed valid for its full
// remaining access-token lifetime after deactivation, live-reproduced and
// left OPEN by the 2026-10-09 audit (M-1) as a documented residual-risk
// trade-off, pending an owner decision on exactly this kind of cheap
// deny-list check. Mirrors AiUsageService's own Redis client construction
// (same redis.host/port/password config, same ioredis instance pattern) --
// a short-TTL deny-list entry per deactivated user, checked once per
// request by JwtStrategy, not a DB round trip on every authenticated
// request in the app.
@Injectable()
export class SessionRevocationService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionRevocationService.name);
  private readonly redis: Redis;

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis({
      host: this.config.get('redis.host'),
      port: this.config.get('redis.port'),
      password: this.config.get('redis.password'),
      lazyConnect: false,
    });
    this.redis.on('error', (err) => this.logger.warn(`Redis connection error: ${err.message}`));
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  private key(userId: string): string {
    return `auth:deactivated:${userId}`;
  }

  // Called the moment a user is deactivated (UsersService.deactivate()).
  // TTL is the configured access-token lifetime plus a 60s safety margin
  // for clock skew between this process and whichever one verified the
  // token -- once that window passes, any access token issued before
  // deactivation would have expired under JwtStrategy's own
  // ignoreExpiration: false check anyway, so the deny-list entry never
  // needs to outlive it.
  async denyFutureAccess(userId: string): Promise<void> {
    const ttlMs = ms(this.config.get<string>('jwt.accessExpiresIn') ?? '15m') + 60_000;
    await this.redis.set(this.key(userId), '1', 'PX', ttlMs);
  }

  // Fails OPEN on a Redis outage: an auth-path dependency that fails
  // closed here would lock every user in the company out of the entire
  // app on a Redis blip, which is a strictly worse outcome than the
  // pre-existing, already-documented 15-minute residual-access window
  // this check exists to narrow -- it degrades back to that prior
  // behavior, not to a new failure mode.
  async isDenied(userId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.key(userId))) === 1;
    } catch (err) {
      this.logger.warn(`Redis unavailable for deactivation deny-list check, failing open: ${(err as Error).message}`);
      return false;
    }
  }
}
