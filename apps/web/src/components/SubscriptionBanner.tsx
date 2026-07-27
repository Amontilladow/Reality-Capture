import type { CompanySubscription } from '@engineeringos/types';
import { UsageIndicator } from './UsageIndicator';

const TIER_LABELS: Record<string, string> = {
  trial: 'Trial',
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
  enterprise: 'Enterprise',
};

export function SubscriptionBanner({ subscription }: { subscription: CompanySubscription }) {
  const trialDaysLeft = subscription.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <div className="tick-frame panel p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">Plan</div>
          <div className="text-sm font-semibold">{TIER_LABELS[subscription.plan.tier] ?? subscription.plan.tier}</div>
        </div>
        {subscription.status === 'trial' && trialDaysLeft !== null && (
          <span className="badge bg-warn/15 text-warn">{trialDaysLeft}d left</span>
        )}
        {subscription.status === 'past_due' && (
          <span className="badge bg-danger/15 text-danger">Past due</span>
        )}
      </div>
      <UsageIndicator
        usage={subscription.usage}
        limits={{
          maxProjects: subscription.plan.maxProjects,
          maxUsers: subscription.plan.maxUsers,
          maxStorageBytes: subscription.plan.maxStorageBytes,
        }}
      />
    </div>
  );
}
