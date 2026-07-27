import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../../database/database.service';
import { FEATURE_KEY } from '../decorators/require-feature.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PaymentRequiredException } from '../exceptions/payment-required.exception';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredFeature = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (!requiredFeature) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    // Join subscription with plan to get feature flags — single query, cached in Redis in production
    const [sub] = await this.db.query`
      SELECT
        sp.feature_flags,
        cs.status,
        cs.trial_ends_at
      FROM company_subscriptions cs
      JOIN subscription_plans sp ON sp.id = cs.plan_id
      WHERE cs.company_id = ${user.companyId}
        AND cs.status IN ('active', 'trial')
    `;

    if (!sub) throw new PaymentRequiredException(requiredFeature);

    // Check trial expiry
    if (sub.status === 'trial' && sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date()) {
      throw new PaymentRequiredException(requiredFeature);
    }

    const flags = sub.featureFlags as Record<string, boolean>;
    if (!flags[requiredFeature]) {
      throw new PaymentRequiredException(requiredFeature);
    }

    return true;
  }
}