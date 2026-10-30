import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EvacPlansController } from './evac-plans.controller';
import { EvacPlansService } from './evac-plans.service';
import { EvacPlansProcessor } from './evac-plans.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'evac-plans',
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 30000 },
      },
    }),
  ],
  controllers: [EvacPlansController],
  providers: [EvacPlansService, EvacPlansProcessor],
})
export class EvacPlansModule {}
