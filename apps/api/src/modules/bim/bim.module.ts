import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BimService } from './bim.service';
import { BimController } from './bim.controller';
import { IFC_PROCESSING_QUEUE } from '@engineeringos/types';
import { IssuesModule } from '../issues/issues.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: IFC_PROCESSING_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    }),
    IssuesModule,
  ],
  controllers: [BimController],
  providers: [BimService],
  exports: [BimService],
})
export class BimModule {}