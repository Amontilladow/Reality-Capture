import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { SiteDrawingsService } from './site-drawings.service';
import { SiteDrawingsController } from './site-drawings.controller';
import { SiteDrawingSyncService } from './site-drawing-sync.service';
import { SiteDrawingImportService } from './site-drawing-import.service';
import { SiteDrawingImportController } from './site-drawing-import.controller';
import { SiteDrawingImportProcessor } from './site-drawing-import.processor';
import { SharePointIntegrationService } from './sharepoint-integration.service';
import { SharePointIntegrationController } from './sharepoint-integration.controller';
import { SiteDrawingLocalAdapter } from './adapters/local-adapter';
import { SiteDrawingSharePointAdapter } from './adapters/sharepoint-adapter';
import { SharePointGraphClient } from './adapters/sharepoint-graph-client';
import { SiteDrawingAdapterRegistry } from './adapters/site-drawing-adapter-registry';

@Module({
  imports: [
    HttpModule,
    BullModule.registerQueue({
      name: 'site-drawing-import',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      },
    }),
  ],
  controllers: [SiteDrawingsController, SharePointIntegrationController, SiteDrawingImportController],
  providers: [
    SiteDrawingsService, SiteDrawingSyncService, SiteDrawingImportService, SiteDrawingImportProcessor,
    SharePointIntegrationService, SiteDrawingLocalAdapter, SiteDrawingSharePointAdapter,
    SharePointGraphClient, SiteDrawingAdapterRegistry,
  ],
  exports: [SiteDrawingsService],
})
export class SiteDrawingsModule {}
