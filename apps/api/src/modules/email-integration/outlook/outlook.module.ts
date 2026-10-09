import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EmailIntegrationModule } from '../email-integration.module';
import { MicrosoftGraphClient } from './microsoft-graph-client';
import { OutlookIntegrationService } from './outlook-integration.service';
import { OutlookIntegrationController } from './outlook-integration.controller';

@Module({
  imports: [HttpModule, EmailIntegrationModule],
  controllers: [OutlookIntegrationController],
  providers: [MicrosoftGraphClient, OutlookIntegrationService],
  exports: [OutlookIntegrationService],
})
export class OutlookModule {}
