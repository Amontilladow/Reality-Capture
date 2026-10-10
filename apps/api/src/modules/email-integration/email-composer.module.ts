import { Module } from '@nestjs/common';
import { OutlookModule } from './outlook/outlook.module';
import { GmailModule } from './gmail/gmail.module';
import { EmailComposerService } from './email-composer.service';
import { EmailComposerController } from './email-composer.controller';

// Phase 3E: the provider-agnostic compose/send/audit layer. Imports both
// provider modules (for OutlookIntegrationService/GmailIntegrationService)
// rather than EmailIntegrationModule directly -- it has no need for
// EmailTokenStore itself, only each provider's own already-composed
// sendMail(). DatabaseService/StorageService come from their own @Global
// modules, so neither needs importing here.
@Module({
  imports: [OutlookModule, GmailModule],
  controllers: [EmailComposerController],
  providers: [EmailComposerService],
  exports: [EmailComposerService],
})
export class EmailComposerModule {}
