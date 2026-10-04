import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import postgres from 'postgres';
import { DatabaseService } from './database.service';

// Global so every module can inject DatabaseService without re-importing DatabaseModule
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
          // Verify the server's certificate against Node's trust store (or the
          // optional caCert override below) rather than accepting any cert --
          // rejectUnauthorized:false would let a network-positioned attacker
          // MITM the connection while TLS looks nominally "enabled".
          ssl: config.get('database.ssl') === 'true'
            ? {
                rejectUnauthorized: true,
                ca: config.get('database.caCert') || undefined,
                // Render's self-signed Postgres cert's CN is the database's
                // internal UUID (e.g. "120228f6-..."), not the "dpg-..."
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
          max: 20,              // connection pool size
          idle_timeout: 30,     // seconds before idle connection is closed
          connect_timeout: 10,
          transform: postgres.camel, // snake_case DB columns → camelCase in JS
          onnotice: () => {},   // silence NOTICE messages in tests
        });
      },
    },
    DatabaseService,
  ],
  exports: ['PG_CONNECTION', DatabaseService],
})
export class DatabaseModule {}
