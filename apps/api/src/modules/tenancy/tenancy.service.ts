import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../../database/database.service';

// 8 chars from an unambiguous 32-symbol alphabet (no 0/O/1/I/L) -- short
// enough to read aloud or type by hand, with a keyspace (32^8 ≈ 1.1
// trillion) large enough that a random collision on UNIQUE insert is not a
// realistic concern, same judgment call this codebase already makes for
// invitation/reset tokens (randomBytes with no collision-retry loop).
const SIGNUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generateSignupCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += SIGNUP_CODE_ALPHABET[bytes[i] % SIGNUP_CODE_ALPHABET.length];
  return code;
}

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
  // that don't have a companyId yet). withSystemBypass required -- see
  // DatabaseService.withSystemBypass() and migration 052.
  async findBySlug(slug: string) {
    const [company] = await this.db.withSystemBypass(sql => sql`
      SELECT id, name, slug, is_active FROM companies WHERE slug = ${slug}
    `);
    return company ?? null;
  }

  /**
   * Register a new company with a Trial subscription.
   * Called during the company self-registration flow (public endpoint).
   * The first user to register becomes company_admin automatically.
   *
   * withSystemBypass (not withTenant) is structurally correct here -- there is no
   * companyId to scope by yet, since this IS the insert that creates one. The `companies`
   * INSERT's implicit WITH CHECK (mirroring the tenant_isolation USING clause, since no
   * separate WITH CHECK is declared) requires company_id/id = current_setting(...), which
   * is never true with no session var set, so this needs the explicit, narrow RLS bypass
   * role from migration 052 for exactly this operation -- see
   * DatabaseService.withSystemBypass().
   */
  async register(dto: { companyName: string; slug: string; adminEmail: string; adminFirstName: string; adminLastName: string; adminPassword: string }) {
    return this.db.withSystemBypass(async (sql) => {
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
  //
  // Bug fix: this previously bound ${JSON.stringify(settings)}::jsonb --
  // postgres.js has no way to tell "this JS string is already-serialized
  // JSON text to parse" apart from "this is a plain string that needs
  // escaping into a JSON string value," so it conservatively treated the
  // pre-stringified text as the latter, producing a JSON *string scalar*
  // holding the escaped JSON text rather than the parsed object. Postgres's
  // jsonb `||` then saw an object on the left and a scalar on the right --
  // a type mismatch it resolves by wrapping both into a 2-element array --
  // so every call to this method silently corrupted companies.settings
  // into an ever-growing array instead of merging. sql.json(settings) is
  // postgres.js's documented helper for binding a JS value as a real jsonb
  // parameter (no cast needed, no re-stringification ambiguity), which
  // merges correctly. Confirmed against a live reproduction before and
  // after this fix.
  async updateSettings(companyId: string, settings: Record<string, unknown>) {
    const [updated] = await this.db.withTenant(companyId, (sql) => {
      // sql.json()'s JSONValue type recursively requires every nested value
      // to itself already be a known-JSON-safe type, which
      // Record<string, unknown> (arbitrary parsed request-body JSON) can
      // never structurally satisfy -- this boundary is inherently "any
      // JSON-safe shape," same as the Record<string, unknown> the
      // controller already accepts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settingsJson = sql.json(settings as any);
      return sql`
        UPDATE companies
        SET settings = settings || ${settingsJson}, updated_at = NOW()
        WHERE id = ${companyId}
        RETURNING id, name, slug, settings
      `;
    });
    return updated;
  }

  // ── Self-signup code (RBAC follow-up) ────────────────────────────────────
  // withTenant required -- see findById() above.
  async getSignupCode(companyId: string) {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT signup_code FROM companies WHERE id = ${companyId}
    `);
    return { signupCode: (row?.signupCode as string | null) ?? null };
  }

  // Overwrites any existing code -- the old one stops working immediately,
  // same "rotate, don't append" model webhooks.rotate-secret already uses
  // elsewhere in this app. withTenant required -- see findById() above.
  async regenerateSignupCode(companyId: string) {
    const code = generateSignupCode();
    const [row] = await this.db.withTenant(companyId, sql => sql`
      UPDATE companies SET signup_code = ${code}, updated_at = NOW()
      WHERE id = ${companyId}
      RETURNING signup_code
    `);
    return { signupCode: row.signupCode as string };
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
