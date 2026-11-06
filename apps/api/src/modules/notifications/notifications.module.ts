import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from '../auth/auth.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationEmailProcessor } from './processors/notification-email.processor';
import { NotificationWhatsAppProcessor } from './processors/notification-whatsapp.processor';
import { NotificationEscalationService } from './notification-escalation.service';
import { NOTIFICATION_EMAIL_QUEUE } from './notification-email.constants';
import { NOTIFICATION_WHATSAPP_QUEUE } from './notification-whatsapp.constants';

const DELIVERY_QUEUE_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 100,
};

@Module({
  imports: [
    // AuthModule already exports a JwtModule.registerAsync()-configured
    // JwtService and SessionRevocationService: reused by NotificationsGateway
    // for its own token verification, same as ChatModule's own gateway.
    AuthModule,
    // Same registerQueue shape as WebhooksModule's own delivery queue --
    // NotificationEmailProcessor/NotificationWhatsAppProcessor run in this
    // worker, retrying a failed send with the same exponential backoff
    // webhook delivery uses. WhatsAppModule is @Global (like EmailModule),
    // so WhatsAppService is available to NotificationWhatsAppProcessor and
    // NotificationsService without importing it here.
    BullModule.registerQueue(
      { name: NOTIFICATION_EMAIL_QUEUE, defaultJobOptions: DELIVERY_QUEUE_JOB_OPTIONS },
      { name: NOTIFICATION_WHATSAPP_QUEUE, defaultJobOptions: DELIVERY_QUEUE_JOB_OPTIONS },
    ),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, NotificationEmailProcessor, NotificationWhatsAppProcessor, NotificationEscalationService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
