import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HealthController } from './health.controller';

@Module({
  // Registers its own handle on the same-named Bull queue purely to reach
  // its underlying Redis client for a ping -- see health.controller.ts.
  imports: [BullModule.registerQueue({ name: 'image-processing' })],
  controllers: [HealthController],
})
export class HealthModule {}