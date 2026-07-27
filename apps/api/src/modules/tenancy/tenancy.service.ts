import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * TenancyService — company-level operations.
 * Handles company lookup, registration, and settings.
 * All per-tenant data access goes through DatabaseService.withTenant().
 */
@Injectable()
export class TenancyService {
  constructor(private readonly db: DatabaseService) {}

  async findById(companyId: string) {
    const [company] = await this.db.query`
      SELECT c.*, cs.status AS subscription_status,
             sp.tier AS plan_tier, sp.name AS plan_name
      FROM companies c
      LEFT JOIN company_subscriptions cs ON cs.company_id = c.id
      LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
      WHERE c.id = ${companyId} AND c.is_active = true
    `;
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }

  async findBySlug(slug: string) {
    const [company] = await this.db.query`
      SELECT id, name, slug, is_active FROM companies WHERE slug = ${slug}
    `;
    return company ?? null;
  }

  /**
   * Register a new company with a Trial subscription.
   * Called during the company self-registration flow (public endpoint).
   * The first user to register becomes company_admin automatically.
   */
  async register(dto: { companyName: string; slug: string; adminEmail: string; adminFirstName: string; adminLastName: string; adminPassword: string }) {
    return this.db.withTransaction(async (sql) => {
      // 1. Get trial plan (needed up front so the company's stored limit matches
      //    the plan actually being assigned, not the column's generic default)
      const [trialPlan] = await sql`
        SELECT id, max_storage_bytes FROM subscription_plans WHERE tier = 'trial'
      `;

      // 2. Create company
      const [company] = await sql`
        INSERT INTO companies (name, slug, plan, storage_limit_bytes)
        VALUES (${dto.companyName}, ${dto.slug.toLowerCase()}, 'trial', ${trialPlan.maxStorageBytes as number})
        RETURNING *
      `;

      // 3. Hash password
      const argon2 = await import('argon2');
      const passwordHash = await argon2.hash(dto.adminPassword, { type: argon2.argon2id });

      // 4. Create admin user
      const [user] = await sql`
        INSERT INTO users (
          company_id, email, password_hash, first_name, last_name,
          company_role, email_verified, is_active
        ) VALUES (
          ${company.id as string}, ${dto.adminEmail.toLowerCase()}, ${passwordHash},
          ${dto.adminFirstName}, ${dto.adminLastName},
          'company_admin', true, true
        )
        RETURNING id, email, first_name, last_name, company_role
      `;

      // 5. Create trial subscription (30 days)
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 30);

      await sql`
        INSERT INTO company_subscriptions (
          company_id, plan_id, status, trial_ends_at,
          current_period_start, current_period_end
        ) VALUES (
          ${company.id as string}, ${trialPlan.id as string}, 'trial',
          ${trialEnd.toISOString()}, NOW(), ${trialEnd.toISOString()}
        )
      `;

      return { company, user };
    });
  }

  async updateSettings(companyId: string, settings: Record<string, unknown>) {
    const [updated] = await this.db.query`
      UPDATE companies
      SET settings = settings || ${JSON.stringify(settings)}::jsonb, updated_at = NOW()
      WHERE id = ${companyId}
      RETURNING id, name, slug, settings
    `;
    return updated;
  }

  async incrementStorage(companyId: string, bytes: number) {
    await this.db.query`
      UPDATE companies
      SET storage_used_bytes = storage_used_bytes + ${bytes}
      WHERE id = ${companyId}
    `;
  }

  async decrementStorage(companyId: string, bytes: number) {
    await this.db.query`
      UPDATE companies
      SET storage_used_bytes = GREATEST(0, storage_used_bytes - ${bytes})
      WHERE id = ${companyId}
    `;
  }
}
