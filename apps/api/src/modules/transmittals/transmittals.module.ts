import { Module } from '@nestjs/common';
import { TransmittalsService } from './transmittals.service';
import { TransmittalsController } from './transmittals.controller';

@Module({
  controllers: [TransmittalsController],
  providers: [TransmittalsService],
  exports: [TransmittalsService],
})
export class TransmittalsModule {}
