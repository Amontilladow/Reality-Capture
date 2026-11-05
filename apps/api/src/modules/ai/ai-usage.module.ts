import { Module } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';

// AiUsageService on its own so feature modules that make their own
// shared-provider LLM calls (RiskModule's briefing/explanation,
// ReportsModule's briefing) can draw on the same per-role quota as the
// assistant. It can't come from AiModule itself: AiModule imports
// RiskModule/ReportsModule's services, so that would be a cycle.
// DatabaseModule/ConfigModule are global, so nothing else to import.
@Module({
  providers: [AiUsageService],
  exports: [AiUsageService],
})
export class AiUsageModule {}
