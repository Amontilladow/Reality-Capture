import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Sql, Row } from 'postgres';

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject('PG_CONNECTION') private readonly sql: Sql) {}

  get query(): Sql {
    return this.sql;
  }

  // Tenant-scoped transaction — mirrors apps/api's DatabaseService exactly.
  // Every write this service makes goes through this so RLS policies fire
  // the same way they do for user-initiated requests through the API.
  async withTenant<T>(companyId: string, fn: (sql: Sql) => Promise<T>): Promise<T> {
    return this.sql.begin(async (txSql) => {
      await txSql`SELECT set_config('app.current_company_id', ${companyId}, true)`;
      return fn(txSql);
    });
  }

  async withTransaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    return this.sql.begin(fn);
  }

  async ping(): Promise<boolean> {
    try {
      await this.sql`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Database ping failed', error);
      return false;
    }
  }
}
