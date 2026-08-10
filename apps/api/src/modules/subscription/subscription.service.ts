import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import Stripe from 'stripe';

@Injectable()
export class SubscriptionService {
  private readonly stripe: Stripe;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {
    this.stripe = new Stripe(config.get<string>('STRIPE_SECRET_KEY', 'sk_test_placeholder'), {
      apiVersion: '2024-04-10',
    });
  }

  async getSubscription(companyId: string) {
    const [sub] = await this.db.query`
      SELECT cs.*, sp.tier, sp.name AS plan_name, sp.max_projects, sp.max_users,
             sp.max_storage_bytes, sp.feature_flags, sp.price_monthly_usd, sp.is_public
      FROM company_subscriptions cs
      JOIN subscription_plans sp ON sp.id = cs.plan_id
      WHERE cs.company_id = ${companyId}`;

    if (!sub) throw new NotFoundException('No subscription found.');

    const [usage] = await this.db.query`
      SELECT
        COUNT(DISTINCT u.id) AS active_users,
        COUNT(DISTINCT p.id) AS active_projects,
        COALESCE(c.storage_used_bytes, 0) AS storage_bytes
      FROM companies c
      -- email_verified = true excludes never-accepted invitations from the
      -- displayed seat usage, matching checkLimit()'s definition of a "used" seat below.
      LEFT JOIN users u ON u.company_id = c.id AND u.is_active = true AND u.email_verified = true
      LEFT JOIN projects p ON p.company_id = c.id AND p.status = 'active'
      WHERE c.id = ${companyId}
      GROUP BY c.storage_used_bytes`;

    // The SubscriptionPlan fields come back flat from the join — nest them
    // under `plan` to match the CompanySubscription type contract that the
    // frontend actually relies on.
    const {
      tier, planName, maxProjects, maxUsers, maxStorageBytes,
      featureFlags, priceMonthlyUsd, isPublic, planId,
      ...subscriptionFields
    } = sub;

    return {
      ...subscriptionFields,
      planId,
      plan: {
        id: planId,
        tier,
        name: planName,
        priceMonthlyUsd,
        maxProjects,
        maxUsers,
        maxStorageBytes,
        featureFlags,
        isPublic,
      },
      usage,
    };
  }

  async getPlans() {
    return this.db.query`
      SELECT * FROM subscription_plans WHERE is_public = true
      ORDER BY price_monthly_usd NULLS LAST`;
  }

  async checkLimit(companyId: string, resource: 'projects' | 'users' | 'storage', additionalBytes = 0): Promise<{ allowed: boolean; reason?: string }> {
    const [data] = await this.db.query`
      SELECT
        sp.max_projects, sp.max_users, sp.max_storage_bytes,
        sp.feature_flags,
        cs.status, cs.trial_ends_at,
        COUNT(DISTINCT p.id) AS project_count,
        COUNT(DISTINCT u.id) AS user_count,
        co.storage_used_bytes
      FROM company_subscriptions cs
      JOIN subscription_plans sp ON sp.id = cs.plan_id
      JOIN companies co ON co.id = cs.company_id
      LEFT JOIN projects p ON p.company_id = co.id AND p.status = 'active'
      -- email_verified = true excludes invitations that were never accepted:
      -- invite() inserts a row with is_active defaulting to true (it never
      -- sets the column) before the invitee has a password or can log in,
      -- so without this an abandoned/unaccepted invite permanently occupies
      -- a paid seat until someone thinks to deactivate it.
      LEFT JOIN users u ON u.company_id = co.id AND u.is_active = true AND u.email_verified = true
      WHERE cs.company_id = ${companyId}
      GROUP BY sp.max_projects, sp.max_users, sp.max_storage_bytes, sp.feature_flags,
               cs.status, cs.trial_ends_at, co.storage_used_bytes`;

    if (!data) return { allowed: false, reason: 'No active subscription found.' };
    if (data.status === 'trial' && data.trialEndsAt && new Date(data.trialEndsAt) < new Date()) {
      return { allowed: false, reason: 'Trial period has expired. Please upgrade to continue.' };
    }

    if (resource === 'projects' && data.maxProjects !== null && Number(data.projectCount) >= Number(data.maxProjects)) {
      return { allowed: false, reason: `Your plan allows a maximum of ${data.maxProjects} active projects.` };
    }
    if (resource === 'users' && data.maxUsers !== null && Number(data.userCount) >= Number(data.maxUsers)) {
      return { allowed: false, reason: `Your plan allows a maximum of ${data.maxUsers} users.` };
    }
    if (resource === 'storage' && data.maxStorageBytes !== null) {
      if (Number(data.storageUsedBytes) + additionalBytes > Number(data.maxStorageBytes)) {
        return { allowed: false, reason: 'Storage limit reached. Upgrade your plan or delete unused captures.' };
      }
    }

    return { allowed: true };
  }

  async createCheckoutSession(companyId: string, tier: string, returnUrl: string): Promise<{ url: string }> {
    const [plan] = await this.db.query`SELECT * FROM subscription_plans WHERE tier = ${tier}`;
    if (!plan) throw new NotFoundException('Plan not found.');
    // In production: create actual Stripe checkout session with price IDs
    // For now returns a placeholder
    return { url: `${returnUrl}?plan=${tier}&demo=true` };
  }

  async handleStripeWebhook(_rawBody: Buffer, _signature: string): Promise<void> {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
    if (!secret) return;
    // Webhook handler — update company_subscriptions based on Stripe events
    // Full implementation in Phase 2 when billing goes live
  }
}