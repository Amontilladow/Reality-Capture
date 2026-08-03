import { Module } from '@nestjs/common';
import { RfisService } from './rfis.service';
import { RfisController } from './rfis.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [RfisController],
  providers: [RfisService],
  exports: [RfisService],
})
export class RfisModule {}
