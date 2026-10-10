import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EmailIntegrationModule } from '../email-integration.module';
import { GmailClient } from './gmail-client';
import { GmailIntegrationService } from './gmail-integration.service';
import { GmailIntegrationController } from './gmail-integration.controller';

@Module({
  imports: [HttpModule, EmailIntegrationModule],
  controllers: [GmailIntegrationController],
  providers: [GmailClient, GmailIntegrationService],
  exports: [GmailIntegrationService],
})
export class GmailModule {}
