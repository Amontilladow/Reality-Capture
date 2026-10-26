import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { GisPrepController } from './gis-prep.controller';
import { GisPrepService } from './gis-prep.service';
import { GisPrepProcessor } from './gis-prep.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'gis-prep',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      },
    }),
  ],
  controllers: [GisPrepController],
  providers: [GisPrepService, GisPrepProcessor],
})
export class GisPrepModule {}
