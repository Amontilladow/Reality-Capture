import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Sql, Row, TransactionSql } from 'postgres';

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject('PG_CONNECTION') private readonly sql: Sql) {}

  // ── Raw query access ───────────────────────────────────────────────────────
  // Use this for complex queries that benefit from tagged template literals
  get query(): Sql {
    return this.sql;
  }

  // ── Tenant-scoped transaction ──────────────────────────────────────────────
  // Every database operation that touches tenant data MUST go through this.
  // Sets app.current_company_id at the Postgres session level so RLS policies
  // fire automatically. The caller never needs to add WHERE company_id = $1
  // to their queries when inside this block — RLS enforces it at DB level.
  //
  // Usage:
  //   await this.db.withTenant(companyId, async (sql) => {
  //     return sql`SELECT * FROM projects`;
  //     // RLS policy ensures only this company's projects are returned,
  //     // even if the SQL has no WHERE clause.
  //   });
  async withTenant<T>(companyId: string, fn: (sql: TransactionSql) => Promise<T>): Promise<T> {
    return this.sql.begin(async (txSql) => {
      // Set the tenant context for RLS — this is the critical line
      await txSql`SELECT set_config('app.current_company_id', ${companyId}, true)`;
      return fn(txSql);
    }) as Promise<T>;
  }

  // ── Transaction without tenant context ────────────────────────────────────
  // For system-level operations (seed, migration, cross-tenant admin queries)
  async withTransaction<T>(fn: (sql: TransactionSql) => Promise<T>): Promise<T> {
    return this.sql.begin(fn) as Promise<T>;
  }

  // ── Explicit, narrow RLS bypass for genuinely pre-tenant/cross-tenant
  // system operations ────────────────────────────────────────────────────────
  // For the small, fixed set of queries that cannot be scoped to one
  // company_id because no company is known yet (login by email, password
  // reset/invitation-accept by token, company self-registration, the RFI
  // external-access token lookup) or because the operation is a deliberate
  // cross-tenant system scan by design (the overdue-issues cron, the
  // screenshot-retention cron). Every one of these used to run as a plain
  // this.db.query()/withTransaction() call, which only worked because the
  // app's runtime DB role was (accidentally) the table owner and so bypassed
  // RLS entirely -- see migration 052's comment for the full history. Now
  // that the runtime role is genuinely RLS-subject, these specific
  // operations need an explicit, auditable escape hatch instead.
  //
  // Originally a role switch (`SET LOCAL ROLE app_bypass_rls`, a NOLOGIN
  // BYPASSRLS role from migration 052) -- replaced by migration 057 with a
  // session-local GUC flag instead, after confirming live that Render's
  // managed Postgres doesn't grant the database owner CREATEROLE, which
  // silently left that role never created and every operation above broken
  // in production. A custom "app.*" parameter needs no special privilege to
  // set (same mechanism withTenant() below already uses for
  // app.current_company_id), and an additional permissive RLS policy per
  // table (migration 057) makes rows visible exactly when this flag is set
  // -- same transaction-scoped lifetime as the role switch had (set_config's
  // third argument, `true`, makes it local to this transaction only; it's
  // gone the moment the transaction ends, same as SET LOCAL ROLE was).
  //
  // Do not reach for this to avoid writing withTenant() -- if a company_id
  // is available, use withTenant(). This is only for the operations listed
  // above, where one genuinely is not.
  async withSystemBypass<T>(fn: (sql: TransactionSql) => Promise<T>): Promise<T> {
    return this.sql.begin(async (txSql) => {
      await txSql`SELECT set_config('app.system_bypass', 'true', true)`;
      return fn(txSql);
    }) as Promise<T>;
  }

  // ── Pagination helper ──────────────────────────────────────────────────────
  // Returns { data, total } from any query result set
  paginate<T extends Row>(
    rows: T[],
    page: number,
    perPage: number,
  ): { data: T[]; total: number; page: number; perPage: number; totalPages: number } {
    // Row keys arrive camelCased (transform: postgres.camel in
    // database.module.ts), so the window-function alias `full_count` shows
    // up here as `fullCount` -- checking for the snake_case key always
    // failed, silently falling back to `rows.length` (the current page's
    // size) as the "total" on every paginated endpoint in the app.
    const total = rows.length > 0 && 'fullCount' in rows[0]
      ? Number((rows[0] as unknown as Row & { fullCount: string }).fullCount)
      : rows.length;

    return {
      data: rows,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  // ── Health check ───────────────────────────────────────────────────────────
  async ping(): Promise<boolean> {
    try {
      await this.sql`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error(`Database ping failed: ${describeError(error)}`);
      return false;
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    return `AggregateError[${error.errors.map(describeError).join(' | ')}]`;
  }
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return `${error.name}${code ? ` (${code})` : ''}: ${error.message}`;
  }
  return String(error);
}
