import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiClientService } from './ai-client.service';

// No controller here -- this module is now purely the internal HTTP client
// other modules (CapturesModule/IssuesModule for ingestion, RiskModule for
// its narrative layer, modules/ai for semantic search) use to talk to the
// Python ai-service. The user-facing assistant route lives in modules/ai
// now, behind the domain guard/usage tracking the old AiClientController
// never had.
@Module({
  imports: [HttpModule],
  providers: [AiClientService],
  exports: [AiClientService],
})
export class AiClientModule {}
