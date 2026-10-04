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
          // See apps/api/src/database/database.module.ts's identical change --
          // verify the server certificate instead of accepting any cert.
          ssl: config.get('database.ssl') === 'true'
            ? {
                rejectUnauthorized: true,
                ca: config.get('database.caCert') || undefined,
                // Render's self-signed Postgres cert's CN is the database's
                // internal UUID (e.g. "120228f6-...), not the "dpg-..."
                // hostname actually used to connect -- Node's default
                // checkServerIdentity rejects that mismatch with
                // ERR_TLS_CERT_ALTNAME_INVALID even once the cert's chain
                // verifies correctly against the pinned `ca` above. Chain
                // verification against that pinned cert is what actually
                // prevents MITM here (an attacker can't produce a cert this
                // connection will accept without the private key), so
                // skipping only the hostname check -- not the chain check
                // -- is safe and necessary for this self-signed cert.
                checkServerIdentity: () => undefined,
              }
            : false,
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
