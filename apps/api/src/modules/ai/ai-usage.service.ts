import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AiRoleLimit } from '../../config/ai.config';
import { DatabaseService } from '../../database/database.service';

export interface UsageCheckResult {
  allowed: boolean;
  reason?: 'daily_limit' | 'rate_limit';
  dailyUsed: number;
  dailyLimit: number;
}

export interface UsageLogEntry {
  companyId: string;
  projectId?: string;
  userId: string;
  userRole: string;
  status: 'allowed' | 'blocked' | 'error';
  category?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  blockReason?: string;
  errorMessage?: string;
}

// Spec sections 12-15: configurable per-role daily + per-minute limits,
// enforced server-side, with a clean "you've hit your limit" message and
// NO quota consumed by a domain-guard-blocked question (spec section 13 --
// checkAndReserve() is only ever called once the domain guard has already
// allowed a question through; see AiService.ask()).
//
// Counters live in Redis (already a dependency via BullModule, just not
// previously exposed as its own injectable client) for fast, cheap
// per-minute/per-day arithmetic -- ai_usage_log in Postgres is the
// permanent telemetry record (spec section 14's usage dashboard source),
// not the hot path for every request's rate check.
@Injectable()
export class AiUsageService implements OnModuleDestroy {
  private readonly logger = new Logger(AiUsageService.name);
  private readonly redis: Redis;

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {
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

  private limitForRole(role: string): AiRoleLimit {
    const limits = this.config.get<Record<string, AiRoleLimit>>('ai.roleLimits')!;
    return limits[role] ?? limits.default;
  }

  // Atomically checks AND reserves one request against both the per-minute
  // and daily buckets in a single round trip -- callers must not call this
  // speculatively and then skip the request, since it already counts.
  async checkAndReserve(userId: string, role: string): Promise<UsageCheckResult> {
    const limit = this.limitForRole(role);
    const dayKey = `ai:usage:day:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const minuteKey = `ai:usage:minute:${userId}:${Math.floor(Date.now() / 60_000)}`;

    const dailyUsed = await this.redis.incr(dayKey);
    if (dailyUsed === 1) await this.redis.expire(dayKey, 60 * 60 * 26); // comfortably past midnight in any timezone
    if (dailyUsed > limit.dailyLimit) {
      await this.redis.decr(dayKey);
      return { allowed: false, reason: 'daily_limit', dailyUsed: dailyUsed - 1, dailyLimit: limit.dailyLimit };
    }

    const minuteUsed = await this.redis.incr(minuteKey);
    if (minuteUsed === 1) await this.redis.expire(minuteKey, 60);
    if (minuteUsed > limit.perMinuteLimit) {
      await this.redis.decr(dayKey);
      await this.redis.decr(minuteKey);
      return { allowed: false, reason: 'rate_limit', dailyUsed: dailyUsed - 1, dailyLimit: limit.dailyLimit };
    }

    return { allowed: true, dailyUsed, dailyLimit: limit.dailyLimit };
  }

  async getRemaining(userId: string, role: string): Promise<{ dailyUsed: number; dailyLimit: number }> {
    const limit = this.limitForRole(role);
    const dayKey = `ai:usage:day:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const used = parseInt((await this.redis.get(dayKey)) ?? '0', 10);
    return { dailyUsed: used, dailyLimit: limit.dailyLimit };
  }

  // Fire-and-forget write to the permanent log -- mirrors AuditInterceptor's
  // own error-isolation pattern (a logging failure must never fail or
  // delay the actual assistant response). Called for every outcome
  // (allowed/blocked/error) so the usage dashboard (spec section 14) can
  // show blocked-vs-allowed, not just successes.
  log(entry: UsageLogEntry): void {
    this.db.withTenant(entry.companyId, (sql) => sql`
      INSERT INTO ai_usage_log (
        company_id, project_id, user_id, user_role, status, category,
        provider, model, input_tokens, output_tokens, latency_ms,
        block_reason, error_message
      ) VALUES (
        ${entry.companyId}, ${entry.projectId ?? null}, ${entry.userId}, ${entry.userRole}, ${entry.status}, ${entry.category ?? null},
        ${entry.provider ?? null}, ${entry.model ?? null}, ${entry.inputTokens ?? null}, ${entry.outputTokens ?? null}, ${entry.latencyMs ?? null},
        ${entry.blockReason ?? null}, ${entry.errorMessage ?? null}
      )
    `).catch((err: unknown) => {
      this.logger.warn(`Failed to write ai_usage_log: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}
