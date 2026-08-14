import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { SubscriptionModule } from '../subscription/subscription.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [SubscriptionModule, StorageModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}