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
