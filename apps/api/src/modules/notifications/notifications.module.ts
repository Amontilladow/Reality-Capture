import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from '../auth/auth.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationEmailProcessor } from './processors/notification-email.processor';
import { NOTIFICATION_EMAIL_QUEUE } from './notification-email.constants';

@Module({
  imports: [
    // AuthModule already exports a JwtModule.registerAsync()-configured
    // JwtService and SessionRevocationService: reused by NotificationsGateway
    // for its own token verification, same as ChatModule's own gateway.
    AuthModule,
    // Same registerQueue shape as WebhooksModule's own delivery queue --
    // NotificationEmailProcessor runs in this worker, retrying a failed
    // send with the same exponential backoff webhook delivery uses.
    BullModule.registerQueue({
      name: NOTIFICATION_EMAIL_QUEUE,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, NotificationEmailProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
