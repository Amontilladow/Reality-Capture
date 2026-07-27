import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import postgres from 'postgres';
import { DatabaseService } from './database.service';

// Global so every module in this service can inject DatabaseService.
// Deliberately a small, independent copy of apps/api's database module —
// not a shared import — so this service can be built, deployed, and
// scaled without any dependency on apps/api's code. Both connect to the
// same Postgres database using the same env var names by convention.
@Global()
@Module({
  providers: [
    {
      provide: 'PG_CONNECTION',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return postgres({
          host: config.get('database.host'),
          port: config.get('database.port'),
          database: config.get('database.name'),
          username: config.get('database.user'),
          password: config.get('database.password'),
          ssl: config.get('database.ssl') === 'true' ? { rejectUnauthorized: false } : false,
          max: 10,
          idle_timeout: 30,
          connect_timeout: 10,
          transform: postgres.camel,
          onnotice: () => {},
        });
      },
    },
    DatabaseService,
  ],
  exports: ['PG_CONNECTION', DatabaseService],
})
export class DatabaseModule {}
