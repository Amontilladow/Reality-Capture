import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';

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
import { TransmittalsModule } from './modules/transmittals/transmittals.module';
import { QaModule } from './modules/qa/qa.module';
import { SnaggingModule } from './modules/snagging/snagging.module';
import { AiClientModule } from './modules/ai-client/ai-client.module';
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
import { PendingApprovalGuard } from './common/guards/pending-approval.guard';

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
    // Registered here rather than in IssuesModule, matching how Bull/Throttler's
    // own forRoot() calls live at the app root rather than in whichever
    // feature module happens to use them first -- ticket 2b's
    // IssueWarningService (apps/api/src/modules/issues/issue-warning.service.ts)
    // is the first @Cron() consumer, but ScheduleModule itself is a
    // cross-cutting root concern like the other forRoot() modules above it.
    ScheduleModule.forRoot(),
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
    TransmittalsModule,
    QaModule,
    SnaggingModule,
    AiClientModule,
    BimModule,
    DocumentsModule,
    DrawingsModule,
    TimelineModule,
    NotificationsModule,
    SubscriptionModule,
  ],
  providers: [
    // Order matters: rate-limit first (cheap, rejects abuse before any auth work),
    // then JWT auth (populates request.user, honors @Public() routes), then the
    // pending-approval gate (blocks a self-registered-but-unapproved user from
    // everything except @AllowPending() routes), then role checks -- pending
    // status is checked before role weight so a blocked user gets a clear
    // PENDING_APPROVAL reason instead of a generic insufficient-role one.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PendingApprovalGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}