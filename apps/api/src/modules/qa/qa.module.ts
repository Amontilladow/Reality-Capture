import { Module } from '@nestjs/common';
import { QaService } from './qa.service';
import { QaController } from './qa.controller';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [RiskModule],
  controllers: [QaController],
  providers: [QaService],
  exports: [QaService],
})
export class QaModule {}
