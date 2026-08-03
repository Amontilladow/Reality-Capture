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
  const sql = postgres({
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME     ?? 'engineeringos',
    username: process.env.DB_USER     ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
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
