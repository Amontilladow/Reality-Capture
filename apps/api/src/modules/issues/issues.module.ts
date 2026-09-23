import { Module } from '@nestjs/common';
import { IssuesService } from './issues.service';
import { IssueWarningService } from './issue-warning.service';
import { IssueScheduledRemindersService } from './issue-scheduled-reminders.service';
import { IssuesController, ElementIssuesController, IssueLookupController } from './issues.controller';
import { AiClientModule } from '../ai-client/ai-client.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AiClientModule, NotificationsModule, StorageModule],
  controllers: [IssuesController, ElementIssuesController, IssueLookupController],
  // IssueWarningService / IssueScheduledRemindersService: server-side
  // @Cron jobs (auto-warning, and firing due scheduleReminder() rows).
  // Registered here, not exported -- nothing outside this module needs to
  // call them directly, they just need to exist as providers so Nest
  // instantiates them (and their @Cron handlers) at boot. Relies on
  // ScheduleModule.forRoot() being registered globally in app.module.ts,
  // same place Bull/Throttler's forRoot() calls live.
  providers: [IssuesService, IssueWarningService, IssueScheduledRemindersService],
  exports: [IssuesService],
})
export class IssuesModule {}