import { Module } from '@nestjs/common';
import { IssuesService } from './issues.service';
import { IssueWarningService } from './issue-warning.service';
import { IssuesController, ElementIssuesController, IssueLookupController } from './issues.controller';
import { AiClientModule } from '../ai-client/ai-client.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AiClientModule, NotificationsModule, StorageModule],
  controllers: [IssuesController, ElementIssuesController, IssueLookupController],
  // IssueWarningService: ticket 2b's server-side auto-warning cron
  // (@Cron in issue-warning.service.ts). Registered here, not exported --
  // nothing outside this module needs to call it directly, it just needs
  // to exist as a provider so Nest instantiates it (and its @Cron handler)
  // at boot. Relies on ScheduleModule.forRoot() being registered globally
  // in app.module.ts, same place Bull/Throttler's forRoot() calls live.
  providers: [IssuesService, IssueWarningService],
  exports: [IssuesService],
})
export class IssuesModule {}