import { Module } from '@nestjs/common';
import { SiteDrawingsService } from './site-drawings.service';
import { SiteDrawingsController } from './site-drawings.controller';
import { SiteDrawingLocalAdapter } from './adapters/local-adapter';

@Module({
  controllers: [SiteDrawingsController],
  providers: [SiteDrawingsService, SiteDrawingLocalAdapter],
  exports: [SiteDrawingsService],
})
export class SiteDrawingsModule {}
