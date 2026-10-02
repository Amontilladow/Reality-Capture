import { Module } from '@nestjs/common';
import { ProgressReportsService } from './progress-reports.service';
import { ProgressReportsController, ProgressReportsPublicController } from './progress-reports.controller';
import { CapturesModule } from '../captures/captures.module';

@Module({
  imports: [CapturesModule],
  controllers: [ProgressReportsController, ProgressReportsPublicController],
  providers: [ProgressReportsService],
  exports: [ProgressReportsService],
})
export class ProgressReportsModule {}
