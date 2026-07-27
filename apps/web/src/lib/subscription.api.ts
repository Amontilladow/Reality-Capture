import type { SubscriptionPlan, CompanySubscription } from '@engineeringos/types';
import { apiGet, apiPost } from './api';

export function getPlans() {
  return apiGet<SubscriptionPlan[]>('/subscription/plans');
}

export function getSubscription() {
  return apiGet<CompanySubscription>('/subscription');
}

export function createCheckoutSession(tier: string, returnUrl: string) {
  return apiPost<{ checkoutUrl: string }>('/subscription/checkout', { tier, returnUrl });
}
