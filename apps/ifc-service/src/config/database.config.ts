import { registerAs } from '@nestjs/config';
export default registerAs('database', () => ({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  name: process.env.DB_NAME ?? 'engineeringos',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  ssl: process.env.DB_SSL ?? 'false',
  // See apps/api/src/config/database.config.ts's identical field for why
  // this is optional -- Render's managed Postgres cert is already covered
  // by Node's default trust store.
  caCert: process.env.DB_CA_CERT,
}));
