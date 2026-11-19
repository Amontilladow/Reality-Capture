import { registerAs } from '@nestjs/config';
export default registerAs('database', () => ({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  name: process.env.DB_NAME ?? 'engineeringos',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  ssl: process.env.DB_SSL ?? 'false',
  // Optional PEM-encoded CA certificate (or chain) for verifying the Postgres
  // server's TLS certificate, for deployments whose DB isn't signed by a
  // public CA already in Node's default trust store. Render's managed
  // Postgres is; this is unset there and verification still happens
  // against the system trust store.
  caCert: process.env.DB_CA_CERT,
  // Upper bound on any single SQL statement from the API's pool, so one
  // runaway query can't hold a pooled connection (and the request waiting
  // on it) indefinitely. Generous on purpose: report exports and the
  // in-process Bull jobs share this pool. Migrations use their own
  // connection (run-migrations.ts) and are not affected. 0 disables.
  statementTimeoutMs: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS ?? '60000', 10),
}));