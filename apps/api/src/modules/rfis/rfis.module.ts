import { Module } from '@nestjs/common';
import { RfisService } from './rfis.service';
import { RfisController } from './rfis.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [NotificationsModule, StorageModule, MessagingModule],
  controllers: [RfisController],
  providers: [RfisService],
  exports: [RfisService],
})
export class RfisModule {}
