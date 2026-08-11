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

  // withTenant required -- companies (policy keyed on id, not company_id -- see
  // migration 001's special case) and company_subscriptions both carry the
  // tenant_isolation RLS policy. A plain this.db.query() never sets
  // app.current_company_id, so under any DB role that isn't the table owner/a
  // superuser this SELECT sees no rows -- every authenticated request that needs
  // the current company (guards, dashboards, etc.) would 404 here.
  async findById(companyId: string) {
    const [company] = await this.db.withTenant(companyId, sql => sql`
      SELECT c.*, cs.status AS subscription_status,
             sp.tier AS plan_tier, sp.name AS plan_name
      FROM companies c
      LEFT JOIN company_subscriptions cs ON cs.company_id = c.id
      LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
      WHERE c.id = ${companyId} AND c.is_active = true
    `);
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }

  // Deliberately global -- slug is a public, pre-tenant lookup (login/registration flows
  // that don't have a companyId yet). Same bootstrap category as auth.service.ts's
  // login-by-email.
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
   *
   * withTransaction (not withTenant) is structurally correct here -- there is no
   * companyId to scope by yet, since this IS the insert that creates one. NOTE: under the
   * app's real DB role (app_user, no BYPASS RLS -- see migration 001), the `companies`
   * INSERT's implicit WITH CHECK (mirroring the tenant_isolation USING clause, since no
   * separate WITH CHECK is declared) requires company_id/id = current_setting(...), which
   * is never true with no session var set -- so this INSERT is rejected outright and
   * self-registration cannot currently succeed in production. This is not fixable by
   * adding withTenant (no companyId exists to scope by); it needs a deliberate bootstrap
   * mechanism (e.g. a narrowly-scoped SECURITY DEFINER function or dedicated role for
   * exactly this operation) -- flagged, not fixed, as part of the RLS/withTenant audit.
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

      // 4. Create admin user -- super_admin, not company_admin: under the
      // permission model, company_admin has zero authority by default
      // beyond creating projects. Seeding a new company's first (and only)
      // account as company_admin would leave it unable to approve anyone,
      // change roles, or touch company settings -- nobody could ever
      // bootstrap it into a working state. super_admin is the one role
      // with full authority, so the account that creates the company is it.
      const [user] = await sql`
        INSERT INTO users (
          company_id, email, password_hash, first_name, last_name,
          company_role, email_verified, is_active
        ) VALUES (
          ${company.id as string}, ${dto.adminEmail.toLowerCase()}, ${passwordHash},
          ${dto.adminFirstName}, ${dto.adminLastName},
          'super_admin', true, true
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

  // withTenant required -- see findById() above.
  async updateSettings(companyId: string, settings: Record<string, unknown>) {
    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE companies
      SET settings = settings || ${JSON.stringify(settings)}::jsonb, updated_at = NOW()
      WHERE id = ${companyId}
      RETURNING id, name, slug, settings
    `);
    return updated;
  }

  // withTenant required -- see findById() above. Without it this silently touches 0 rows,
  // so storage_used_bytes never actually increments and quota checks never see real usage.
  async incrementStorage(companyId: string, bytes: number) {
    await this.db.withTenant(companyId, sql => sql`
      UPDATE companies
      SET storage_used_bytes = storage_used_bytes + ${bytes}
      WHERE id = ${companyId}
    `);
  }

  // withTenant required -- see incrementStorage() above.
  async decrementStorage(companyId: string, bytes: number) {
    await this.db.withTenant(companyId, sql => sql`
      UPDATE companies
      SET storage_used_bytes = GREATEST(0, storage_used_bytes - ${bytes})
      WHERE id = ${companyId}
    `);
  }
}
