import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';

import { DatabaseModule } from './database/database.module';
import { AuthorizationModule } from './common/authorization/authorization.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { UsersModule } from './modules/users/users.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { BuildingsModule } from './modules/buildings/buildings.module';
import { CapturesModule } from './modules/captures/captures.module';
import { IssuesModule } from './modules/issues/issues.module';
import { RfisModule } from './modules/rfis/rfis.module';
import { QaqcModule } from './modules/qaqc/qaqc.module';
import { SubmittalsModule } from './modules/submittals/submittals.module';
import { TransmittalsModule } from './modules/transmittals/transmittals.module';
import { QaModule } from './modules/qa/qa.module';
import { SnaggingModule } from './modules/snagging/snagging.module';
import { AiClientModule } from './modules/ai-client/ai-client.module';
import { AiModule } from './modules/ai/ai.module';
import { AiConnectionsModule } from './modules/ai-connections/ai-connections.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ProgressReportsModule } from './modules/progress-reports/progress-reports.module';
import { BimModule } from './modules/bim/bim.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { DrawingsModule } from './modules/drawings/drawings.module';
import { TimelineModule } from './modules/timeline/timeline.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { ChatModule } from './modules/chat/chat.module';
import { StorageModule } from './modules/storage/storage.module';
import { EmailModule } from './modules/email/email.module';
import { AuditModule } from './modules/audit/audit.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { WorkforceModule } from './modules/workforce/workforce.module';
import { RiskModule } from './modules/risk/risk.module';
import { HealthModule } from './modules/health/health.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { OutlookModule } from './modules/email-integration/outlook/outlook.module';
import { GmailModule } from './modules/email-integration/gmail/gmail.module';
import { EmailComposerModule } from './modules/email-integration/email-composer.module';

import { APP_INTERCEPTOR, APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ExactRolesGuard } from './common/guards/exact-roles.guard';
import { PendingApprovalGuard } from './common/guards/pending-approval.guard';
import { ProjectPermissionGuard } from './common/guards/project-permission.guard';
import { CategoryActionGuard } from './common/guards/category-action.guard';
import { TenancyGuard } from './common/guards/tenancy.guard';
import { SiteRoleRestrictionGuard } from './common/guards/site-role-restriction.guard';
import { SubcontractorRfiAccessGuard } from './common/guards/subcontractor-rfi-access.guard';
import { SectionSevenViewOnlyGuard } from './common/guards/section-seven-view-only.guard';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import storageConfig from './config/storage.config';
import redisConfig from './config/redis.config';
import googleCalendarConfig from './config/google-calendar.config';
import aiConfig from './config/ai.config';
import emailConfig from './config/email.config';
import microsoftGraphConfig from './config/microsoft-graph.config';
import gmailConfig from './config/google-gmail.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig, storageConfig, redisConfig, googleCalendarConfig, aiConfig, emailConfig, microsoftGraphConfig, gmailConfig],
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
    AuthorizationModule,
    StorageModule,
    EmailModule,
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
    QaqcModule,
    SubmittalsModule,
    TransmittalsModule,
    QaModule,
    SnaggingModule,
    AiClientModule,
    AiModule,
    AiConnectionsModule,
    ReportsModule,
    ProgressReportsModule,
    BimModule,
    DocumentsModule,
    DrawingsModule,
    TimelineModule,
    NotificationsModule,
    MessagingModule,
    ChatModule,
    SubscriptionModule,
    WorkforceModule,
    OutlookModule,
    GmailModule,
    EmailComposerModule,
    RiskModule,
    ApiKeysModule,
    WebhooksModule,
    PublicApiModule,
  ],
  providers: [
    // Order matters: rate-limit first (cheap, rejects abuse before any auth work),
    // then JWT auth (populates request.user, honors @Public() routes), then the
    // pending-approval gate (blocks a self-registered-but-unapproved user from
    // everything except @AllowPending() routes), then TenancyGuard (re-checks
    // companies.is_active on every request, not just login/refresh -- was
    // implemented but never wired up, leaving a deactivated company's
    // already-issued access tokens live until they expire), then role checks
    // -- pending status is checked before role weight so a blocked user gets
    // a clear PENDING_APPROVAL reason instead of a generic insufficient-role
    // one. ProjectPermissionGuard runs last: it's the most specific check (one
    // project, one named capability) and only matters once the broader
    // company-role gate above has already passed.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PendingApprovalGuard },
    { provide: APP_GUARD, useClass: TenancyGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Membership-based sibling to RolesGuard's weight threshold -- see
    // ExactRolesGuard/@RequireExactRoles() for why QAQC NCR/SOR create/close
    // needed this instead of @Roles().
    { provide: APP_GUARD, useClass: ExactRolesGuard },
    { provide: APP_GUARD, useClass: ProjectPermissionGuard },
    // The owner's org-category RBAC sprint: a sibling of ProjectPermissionGuard
    // above (same metadata-driven, "no decorator = not gated" shape), gated
    // by @RequireCategoryAction() instead of @RequireProjectPermission().
    // Composes the new company-wide category matrix with the pre-existing
    // discretionary grant system via OR -- see CategoryActionGuard's own
    // header comment. Runs right after ProjectPermissionGuard since it's
    // conceptually an additional grant path alongside it, before the two
    // cross-cutting, never-loosening guards below.
    { provide: APP_GUARD, useClass: CategoryActionGuard },
    // Runs last of all: an additional, cross-cutting restriction for Site
    // Engineer/Construction Manager/Project Engineer (full working access
    // to Floor Plans/Issues/Snagging, read-only -- no access at all for
    // project settings/users/billing -- elsewhere), applied on top of
    // whatever the guards above already decided, never loosening it.
    { provide: APP_GUARD, useClass: SiteRoleRestrictionGuard },
    // Also runs last: a 'subcontractor' project member (an outside party,
    // unlike every SiteRoleRestrictionGuard case above) gets access to this
    // project's RFI module only -- reads included, unlike that guard's
    // read-everywhere shape. See the guard's own header comment.
    { provide: APP_GUARD, useClass: SubcontractorRfiAccessGuard },
    // Also runs last: the owner's org-category RBAC sprint, matrix section
    // 7 -- Chairman/General Manager/Operations Manager get view-only access
    // to Risk/Reports/Snagging/BuildLens Captures. Independent of (and
    // unaffected by) the two guards above it -- it only ever narrows what
    // those 3 specific company roles can do, never widens anything.
    { provide: APP_GUARD, useClass: SectionSevenViewOnlyGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}