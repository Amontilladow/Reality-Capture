/**
 * Migration runner — executes all SQL migration files in order.
 * Called by: pnpm db:migrate
 *
 * Strategy: tracks applied migrations in the _migrations table.
 * Safe to run multiple times — skips already-applied migrations.
 */
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import postgres from 'postgres';
import * as dotenv from 'dotenv';

// __dirname is apps/api/src/database -- two levels up is apps/api, where
// .env.local/.env actually live. This was previously '../../../../' (four
// levels, landing at the repo root, which has no such file) -- silently
// falling through to this script's hardcoded default of port 5432 instead
// of whatever apps/api/.env.local actually specifies. On a machine with
// nothing else on 5432 this default happens to match docker-compose's own
// default and the bug is invisible; it broke the moment anything else
// (e.g. an unrelated native Postgres install) was also listening there.
dotenv.config({ path: join(__dirname, '../../.env.local') });
dotenv.config({ path: join(__dirname, '../../.env') });

const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function runMigrations() {
  // Migrations need to run as whatever role owns the tables (or a superuser) --
  // that's a different identity from the one the running application should use
  // at runtime once migration 052 makes app_user genuinely RLS-subject. Falls
  // back to DB_USER/DB_PASSWORD when DB_MIGRATOR_* is unset, so a single-
  // credential setup (local dev, anyone who hasn't adopted the split yet) keeps
  // working exactly as before.
  const migratorUser     = process.env.DB_MIGRATOR_USER     ?? process.env.DB_USER     ?? 'postgres';
  const migratorPassword = process.env.DB_MIGRATOR_PASSWORD ?? process.env.DB_PASSWORD ?? 'postgres';

  const sql = postgres({
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME     ?? 'engineeringos',
    username: migratorUser,
    password: migratorPassword,
    // Verify the server certificate -- see database.module.ts's identical fix,
    // including the checkServerIdentity override's own comment for why it's
    // needed (Render's self-signed cert's CN doesn't match the "dpg-..."
    // connection hostname).
    ssl: process.env.DB_SSL === 'true'
      ? {
          rejectUnauthorized: true,
          ca: process.env.DB_CA_CERT || undefined,
          checkServerIdentity: () => undefined,
        }
      : false,
    max:      1,
  });

  try {
    // Ensure migration registry exists
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL PRIMARY KEY,
        filename   VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `;

    // Get already-applied migrations
    const applied = await sql`SELECT filename FROM _migrations ORDER BY filename`;
    const appliedSet = new Set(applied.map(r => r.filename as string));

    // Read all .sql files sorted alphabetically (001_, 002_, 003_ prefix pattern)
    const files = (await readdir(MIGRATIONS_DIR))
      .filter(f => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const filename of files) {
      if (appliedSet.has(filename)) {
        console.log(`  SKIP  ${filename} (already applied)`);
        continue;
      }

      const filePath = join(MIGRATIONS_DIR, filename);
      const content  = await readFile(filePath, 'utf-8');

      console.log(`  RUN   ${filename}`);
      await sql.unsafe(content);
      await sql`INSERT INTO _migrations (filename) VALUES (${filename}) ON CONFLICT DO NOTHING`;
      ran++;
      console.log(`  OK    ${filename}`);
    }

    if (ran === 0) {
      console.log('\nAll migrations already applied — database is up to date.');
    } else {
      console.log(`\n${ran} migration(s) applied successfully.`);
    }

    // Keep app_user's password in sync with whatever the running application
    // will actually connect with (DB_PASSWORD), using the migrator connection's
    // privilege to do it. ALTER ROLE ... PASSWORD does not accept a bind
    // parameter directly (confirmed by hand: Postgres rejects `ALTER ROLE x
    // WITH PASSWORD $1` with a syntax error, even via the extended query
    // protocol) -- a session-local SQL function is the safe way to pass the
    // password through as a real, parameterized function argument rather than
    // interpolating it into a SQL string. format('%L', ...) inside the
    // function does the actual literal-quoting server-side.
    if (process.env.DB_PASSWORD) {
      await sql`
        CREATE OR REPLACE FUNCTION pg_temp.set_role_password(role_name text, new_password text)
        RETURNS void AS $f$
        BEGIN
          EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', role_name, new_password);
        END;
        $f$ LANGUAGE plpgsql
      `;
      await sql`SELECT pg_temp.set_role_password('app_user', ${process.env.DB_PASSWORD})`;
      console.log('  OK    synced app_user password');
    }
  } catch (error) {
    console.error('\nMigration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigrations().catch(err => {
  console.error(err);
  process.exit(1);
});
