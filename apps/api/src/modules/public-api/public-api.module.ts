import { Module } from '@nestjs/common';
import { PublicApiService } from './public-api.service';
import { PublicApiController } from './public-api.controller';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard';
import { ProjectsModule } from '../projects/projects.module';
import { CapturesModule } from '../captures/captures.module';
import { IssuesModule } from '../issues/issues.module';
import { ProgressReportsModule } from '../progress-reports/progress-reports.module';

@Module({
  imports: [ProjectsModule, CapturesModule, IssuesModule, ProgressReportsModule],
  controllers: [PublicApiController],
  providers: [PublicApiService, ApiKeyAuthGuard],
})
export class PublicApiModule {}
