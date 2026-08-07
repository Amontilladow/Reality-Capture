import { Module } from '@nestjs/common';
import { SnaggingService } from './snagging.service';
import { SnaggingController } from './snagging.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [SnaggingController],
  providers: [SnaggingService],
  exports: [SnaggingService],
})
export class SnaggingModule {}
