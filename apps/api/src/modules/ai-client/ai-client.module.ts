import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiClientService } from './ai-client.service';
import { AiClientController } from './ai-client.controller';
import { ReportsController } from './reports.controller';

@Module({
  imports: [HttpModule],
  controllers: [AiClientController, ReportsController],
  providers: [AiClientService],
  exports: [AiClientService],
})
export class AiClientModule {}
