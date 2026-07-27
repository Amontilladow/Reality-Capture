import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CapturesService } from './captures.service';
import { CapturesController, CapturesSyncController } from './captures.controller';
import { ImageProcessingProcessor } from './processors/image-processing.processor';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AiClientModule } from '../ai-client/ai-client.module';

@Module({
  imports: [
    TenancyModule,
    AiClientModule,
    BullModule.registerQueue({
      name: 'image-processing',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),
  ],
  controllers: [CapturesController, CapturesSyncController],
  providers: [CapturesService, ImageProcessingProcessor],
  exports: [CapturesService],
})
export class CapturesModule {}