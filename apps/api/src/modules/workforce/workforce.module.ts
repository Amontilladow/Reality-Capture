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

@Module({
  controllers: [
    DevicesController,
    ApplicationsController,
    ActivitiesController,
    ProductivityController,
    PrivacyController,
    TeamController,
    ReportingLinesController,
  ],
  providers: [
    DevicesService,
    ApplicationsService,
    ActivitiesService,
    ProductivityService,
    PrivacyService,
    TeamService,
    ReportingLinesService,
  ],
  exports: [ActivitiesService, ProductivityService],
})
export class WorkforceModule {}
