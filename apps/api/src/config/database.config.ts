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
  // Postgres is -- this is unset there and verification still happens
  // against the system trust store.
  caCert: process.env.DB_CA_CERT,
}));