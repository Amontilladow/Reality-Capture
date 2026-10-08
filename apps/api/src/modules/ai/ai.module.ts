import { Module } from '@nestjs/common';
import { RfisModule } from '../rfis/rfis.module';
import { IssuesModule } from '../issues/issues.module';
import { SnaggingModule } from '../snagging/snagging.module';
import { RiskModule } from '../risk/risk.module';
import { ProgressReportsModule } from '../progress-reports/progress-reports.module';
import { DocumentsModule } from '../documents/documents.module';
import { ProjectsModule } from '../projects/projects.module';
import { AiClientModule } from '../ai-client/ai-client.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiToolsService } from './ai-tools.service';
import { AiUsageService } from './ai-usage.service';
import { DomainGuardService } from './domain-guard.service';
import { ProviderFactory } from './providers/provider.factory';

// The AI Gateway (spec section 2/28): everything the rebuild brief asks for
// -- domain guard, project-scoped tools, usage tracking, rate limiting,
// provider abstraction -- lives here, importing the EXISTING feature
// modules' services rather than re-implementing any of their query/
// authorization logic. AuthorizationModule/DatabaseModule are both
// @Global(), so they don't need to be listed here.
@Module({
  imports: [
    RfisModule, IssuesModule, SnaggingModule, RiskModule,
    ProgressReportsModule, DocumentsModule, ProjectsModule, AiClientModule,
  ],
  controllers: [AiController],
  providers: [AiService, AiToolsService, AiUsageService, DomainGuardService, ProviderFactory],
})
export class AiModule {}
