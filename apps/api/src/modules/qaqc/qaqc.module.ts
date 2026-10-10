import { Module } from '@nestjs/common';
import { QaqcService } from './qaqc.service';
import { QaqcController } from './qaqc.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [NotificationsModule, StorageModule, RiskModule],
  controllers: [QaqcController],
  providers: [QaqcService],
  exports: [QaqcService],
})
export class QaqcModule {}
