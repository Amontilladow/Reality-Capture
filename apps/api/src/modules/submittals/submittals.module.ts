import { Module } from '@nestjs/common';
import { SubmittalsService } from './submittals.service';
import { SubmittalsController } from './submittals.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [NotificationsModule, RiskModule],
  controllers: [SubmittalsController],
  providers: [SubmittalsService],
  exports: [SubmittalsService],
})
export class SubmittalsModule {}
