import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { CompanyReportsController } from './company-reports.controller';
import { StorageModule } from '../storage/storage.module';
import { IssuesModule } from '../issues/issues.module';
import { SnaggingModule } from '../snagging/snagging.module';
import { RfisModule } from '../rfis/rfis.module';
import { QaqcModule } from '../qaqc/qaqc.module';
import { RiskModule } from '../risk/risk.module';
import { AiClientModule } from '../ai-client/ai-client.module';
import { BimModule } from '../bim/bim.module';

@Module({
  // IssuesModule/SnaggingModule/RfisModule/QaqcModule/RiskModule/BimModule
  // imported (not re-implemented) so ReportsService can call the
  // getKpiBreakdown()/getOpenList()-equivalent sibling methods and
  // RiskService's own getExecutiveSummary() directly on the existing
  // services -- every module already exports what's needed. RiskModule ->
  // ReportsModule is a one-way edge (RiskModule itself only imports
  // DatabaseModule/AiClientModule), so no circular-dependency risk.
  // AiClientModule is the same AI reasoning layer RiskModule already uses,
  // reused (not reimplemented) for the Reports AI briefing.
  imports: [StorageModule, IssuesModule, SnaggingModule, RfisModule, QaqcModule, RiskModule, AiClientModule, BimModule],
  controllers: [ReportsController, CompanyReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
