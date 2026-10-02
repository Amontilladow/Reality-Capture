import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { IFC_PROCESSING_QUEUE } from '@engineeringos/types';
import { IfcProcessingProcessor } from './ifc-processing.processor';
import { IfcParserService } from './ifc-parser.service';
import { IfcFragmentsService } from './ifc-fragments.service';
import { IfcRepositoryService } from './ifc-repository.service';
import { IfcReportService } from './ifc-report.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: IFC_PROCESSING_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 100,
        removeOnFail: 100,
        // Bounds a single parse job's runtime: without this, a structurally
        // pathological (but <500MB) IFC file has no kill switch, and since
        // main.ts runs this worker in the same process as the /health
        // endpoint, an unbounded job can degrade liveness checks for the
        // whole instance.
        timeout: 20 * 60 * 1000,
      },
    }),
  ],
  providers: [IfcProcessingProcessor, IfcParserService, IfcFragmentsService, IfcRepositoryService, IfcReportService],
})
export class IfcProcessingModule {}
