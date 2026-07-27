export type SubscriptionTier = 'trial' | 'starter' | 'professional' | 'business' | 'enterprise';
export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'trial';

export interface SubscriptionPlan {
  id: string;
  tier: SubscriptionTier;
  name: string;
  priceMonthlyUsd?: number;
  priceAnnualUsd?: number;
  maxProjects?: number;
  maxUsers?: number;
  maxStorageBytes?: number;
  featureFlags: FeatureFlags;
  isPublic: boolean;
}

export interface FeatureFlags {
  bim: boolean;
  ai: boolean;
  mobileApp: boolean;
  auditExport: boolean;
  dmsIntegration: boolean;
  onPremise: boolean;
  slaGuarantee: boolean;
}

export interface CompanySubscription {
  id: string;
  companyId: string;
  planId: string;
  status: SubscriptionStatus;
  trialEndsAt?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  plan: SubscriptionPlan;
  usage: UsageMetrics;
}

export interface UsageMetrics {
  activeUsers: number;
  activeProjects: number;
  storageBytes: number;
  capturesUploaded: number;
  aiQueries: number;
}
