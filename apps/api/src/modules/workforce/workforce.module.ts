import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
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
import { CalendarIntegrationController } from './calendar-integration/calendar-integration.controller';
import { CalendarIntegrationService } from './calendar-integration/calendar-integration.service';
import { GoogleCalendarClient } from './calendar-integration/google-calendar-client';

@Module({
  imports: [HttpModule],
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
    CalendarIntegrationController,
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
    CalendarIntegrationService,
    GoogleCalendarClient,
  ],
  exports: [ActivitiesService, ProductivityService],
})
export class WorkforceModule {}
