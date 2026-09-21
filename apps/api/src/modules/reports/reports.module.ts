import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { StorageModule } from '../storage/storage.module';
import { IssuesModule } from '../issues/issues.module';
import { SnaggingModule } from '../snagging/snagging.module';
import { RfisModule } from '../rfis/rfis.module';

@Module({
  // IssuesModule/SnaggingModule/RfisModule imported (not re-implemented) so
  // ReportsService can call the getKpiBreakdown()/getOpenList()-equivalent
  // sibling methods directly on the existing Issues/Snagging/RfisService --
  // all three modules already export their service. RFIs join the Reports
  // module for the first time here (see ReportsService.getKpis()'s comment).
  imports: [StorageModule, IssuesModule, SnaggingModule, RfisModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
