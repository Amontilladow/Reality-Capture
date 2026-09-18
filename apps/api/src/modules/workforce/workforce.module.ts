import { Module } from '@nestjs/common';
import { DevicesController } from './devices/devices.controller';
import { DevicesService } from './devices/devices.service';
import { ApplicationsController } from './applications/applications.controller';
import { ApplicationsService } from './applications/applications.service';
import { ActivitiesController } from './activities/activities.controller';
import { ActivitiesService } from './activities/activities.service';
import { ProductivityController } from './productivity/productivity.controller';
import { ProductivityService } from './productivity/productivity.service';
import { PrivacyController } from './privacy/privacy.controller';
import { PrivacyService } from './privacy/privacy.service';
import { TeamController } from './team/team.controller';
import { TeamService } from './team/team.service';
import { ReportingLinesController } from './reporting-lines/reporting-lines.controller';
import { ReportingLinesService } from './reporting-lines/reporting-lines.service';
import { ScreenshotsController } from './screenshots/screenshots.controller';
import { ScreenshotsService } from './screenshots/screenshots.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { SchedulingController } from './scheduling/scheduling.controller';
import { SchedulingService } from './scheduling/scheduling.service';

@Module({
  controllers: [
    DevicesController,
    ApplicationsController,
    ActivitiesController,
    ProductivityController,
    PrivacyController,
    TeamController,
    ReportingLinesController,
    ScreenshotsController,
    ReportsController,
    SchedulingController,
  ],
  providers: [
    DevicesService,
    ApplicationsService,
    ActivitiesService,
    ProductivityService,
    PrivacyService,
    TeamService,
    ReportingLinesService,
    ScreenshotsService,
    ReportsService,
    SchedulingService,
  ],
  exports: [ActivitiesService, ProductivityService],
})
export class WorkforceModule {}
