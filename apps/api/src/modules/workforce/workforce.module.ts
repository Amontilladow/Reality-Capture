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

@Module({
  controllers: [
    DevicesController,
    ApplicationsController,
    ActivitiesController,
    ProductivityController,
    PrivacyController,
  ],
  providers: [
    DevicesService,
    ApplicationsService,
    ActivitiesService,
    ProductivityService,
    PrivacyService,
  ],
  exports: [ActivitiesService, ProductivityService],
})
export class WorkforceModule {}
