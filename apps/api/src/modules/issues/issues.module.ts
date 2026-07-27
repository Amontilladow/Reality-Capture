import { Module } from '@nestjs/common';
import { IssuesService } from './issues.service';
import { IssuesController, ElementIssuesController } from './issues.controller';
import { AiClientModule } from '../ai-client/ai-client.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AiClientModule, NotificationsModule],
  controllers: [IssuesController, ElementIssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}