import { Module } from '@nestjs/common';
import { SnaggingService } from './snagging.service';
import { SnaggingController } from './snagging.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [NotificationsModule, StorageModule],
  controllers: [SnaggingController],
  providers: [SnaggingService],
  exports: [SnaggingService],
})
export class SnaggingModule {}
