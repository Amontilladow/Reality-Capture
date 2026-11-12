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
import { AiClientModule } from '../ai-client/ai-client.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    HttpModule,
    AiClientModule,
    NotificationsModule,
    BullModule.registerQueue({
      name: 'site-drawing-import',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      },
    }),
  ],
  // SiteDrawingImportController's routes are nested UNDER SiteDrawingsController's
  // own path ('projects/:projectId/site-drawings/import-batches' vs.
  // 'projects/:projectId/site-drawings'), so it must be registered first:
  // Nest/Express matches controller routes in registration order, and
  // SiteDrawingsController's own GET ':id' would otherwise match a request
  // for ".../site-drawings/import-batches" first (treating the literal
  // "import-batches" segment as the :id param) before
  // SiteDrawingImportController's own, more specific route is ever tried --
  // confirmed by hand against the real failure: GET .../import-batches was
  // 500ing with `invalid input syntax for type uuid: "import-batches"`,
  // which is exactly SiteDrawingsController's :id handler choking on a
  // non-UUID "id".
  controllers: [SiteDrawingImportController, SharePointIntegrationController, SiteDrawingsController],
  providers: [
    SiteDrawingsService, SiteDrawingSyncService, SiteDrawingImportService, SiteDrawingImportProcessor,
    SharePointIntegrationService, SiteDrawingLocalAdapter, SiteDrawingSharePointAdapter,
    SharePointGraphClient, SiteDrawingAdapterRegistry,
  ],
  exports: [SiteDrawingsService],
})
export class SiteDrawingsModule {}
