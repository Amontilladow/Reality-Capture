import { Module } from '@nestjs/common';
import { SnaggingService } from './snagging.service';
import { SnaggingController } from './snagging.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [NotificationsModule, StorageModule, RiskModule],
  controllers: [SnaggingController],
  providers: [SnaggingService],
  exports: [SnaggingService],
})
export class SnaggingModule {}
