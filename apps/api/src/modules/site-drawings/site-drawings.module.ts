import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SiteDrawingsService } from './site-drawings.service';
import { SiteDrawingsController } from './site-drawings.controller';
import { SiteDrawingLocalAdapter } from './adapters/local-adapter';
import { SiteDrawingSharePointAdapter } from './adapters/sharepoint-adapter';
import { SharePointGraphClient } from './adapters/sharepoint-graph-client';
import { SiteDrawingAdapterRegistry } from './adapters/site-drawing-adapter-registry';

@Module({
  imports: [HttpModule],
  controllers: [SiteDrawingsController],
  providers: [
    SiteDrawingsService, SiteDrawingLocalAdapter, SiteDrawingSharePointAdapter,
    SharePointGraphClient, SiteDrawingAdapterRegistry,
  ],
  exports: [SiteDrawingsService],
})
export class SiteDrawingsModule {}
