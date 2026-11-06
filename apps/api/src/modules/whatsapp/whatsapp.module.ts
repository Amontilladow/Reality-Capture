import { Global, Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

// Global, same as EmailModule: WhatsAppService is a cross-cutting
// integration every other module (just NotificationsModule's processor,
// for now) should be able to inject without this module needing to be
// re-imported everywhere.
@Global()
@Module({
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
