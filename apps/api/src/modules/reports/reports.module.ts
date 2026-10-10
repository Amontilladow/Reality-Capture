import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { StorageModule } from '../storage/storage.module';
import { IssuesModule } from '../issues/issues.module';
import { SnaggingModule } from '../snagging/snagging.module';
import { RfisModule } from '../rfis/rfis.module';
import { QaqcModule } from '../qaqc/qaqc.module';

@Module({
  // IssuesModule/SnaggingModule/RfisModule/QaqcModule imported (not
  // re-implemented) so ReportsService can call the getKpiBreakdown()/
  // getOpenList()-equivalent sibling methods directly on the existing
  // Issues/Snagging/Rfis/QaqcService -- all four modules already export
  // their service.
  imports: [StorageModule, IssuesModule, SnaggingModule, RfisModule, QaqcModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
