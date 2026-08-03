import { Module } from '@nestjs/common';
import { IssuesService } from './issues.service';
import { IssuesController, ElementIssuesController, IssueLookupController } from './issues.controller';
import { AiClientModule } from '../ai-client/ai-client.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AiClientModule, NotificationsModule, StorageModule],
  controllers: [IssuesController, ElementIssuesController, IssueLookupController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}