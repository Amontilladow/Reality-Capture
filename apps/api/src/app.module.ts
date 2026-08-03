import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';

import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { UsersModule } from './modules/users/users.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { BuildingsModule } from './modules/buildings/buildings.module';
import { CapturesModule } from './modules/captures/captures.module';
import { IssuesModule } from './modules/issues/issues.module';
import { RfisModule } from './modules/rfis/rfis.module';
import { SubmittalsModule } from './modules/submittals/submittals.module';
import { BimModule } from './modules/bim/bim.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { DrawingsModule } from './modules/drawings/drawings.module';
import { TimelineModule } from './modules/timeline/timeline.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StorageModule } from './modules/storage/storage.module';
import { AuditModule } from './modules/audit/audit.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { HealthModule } from './modules/health/health.module';

import { APP_INTERCEPTOR, APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import storageConfig from './config/storage.config';
import redisConfig from './config/redis.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig, storageConfig, redisConfig],
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
      { name: 'auth',    ttl: 60_000, limit: 10  },
    ]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('redis.host'),
          port: config.get('redis.port'),
          password: config.get('redis.password'),
        },
      }),
    }),
    DatabaseModule,
    StorageModule,
    AuditModule,
    HealthModule,
    TenancyModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    BuildingsModule,
    CapturesModule,
    IssuesModule,
    RfisModule,
    SubmittalsModule,
    BimModule,
    DocumentsModule,
    DrawingsModule,
    TimelineModule,
    NotificationsModule,
    SubscriptionModule,
  ],
  providers: [
    // Order matters: rate-limit first (cheap, rejects abuse before any auth work),
    // then JWT auth (populates request.user, honors @Public() routes), then role
    // checks (reads request.user, so must run after JwtAuthGuard).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}