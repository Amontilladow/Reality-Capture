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
            ? { rejectUnauthorized: true, ca: config.get('database.caCert') || undefined }
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
