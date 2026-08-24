import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { StorageModule } from '../storage/storage.module';
import { IssuesModule } from '../issues/issues.module';
import { SnaggingModule } from '../snagging/snagging.module';

@Module({
  // IssuesModule/SnaggingModule imported (not re-implemented) so ReportsService
  // can call the new getKpiBreakdown()/getOpenList() sibling methods directly
  // on the existing IssuesService/SnaggingService -- both modules already
  // export their service.
  imports: [StorageModule, IssuesModule, SnaggingModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
