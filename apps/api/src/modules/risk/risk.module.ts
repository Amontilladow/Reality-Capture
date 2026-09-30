import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AiClientModule } from '../ai-client/ai-client.module';
import { RiskGraphService } from './risk-graph.service';
import { RelationshipExtractionService } from './relationship-extraction.service';
import { SignalsService } from './signals.service';
import { ScoringService } from './scoring.service';
import { RiskService } from './risk.service';
import { RiskController } from './risk.controller';

@Module({
  imports: [DatabaseModule, AiClientModule],
  controllers: [RiskController],
  providers: [RiskGraphService, RelationshipExtractionService, SignalsService, ScoringService, RiskService],
  exports: [RiskGraphService, RiskService],
})
export class RiskModule {}
