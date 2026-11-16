import { Module } from '@nestjs/common';
import { WorkforceModule } from '../workforce/workforce.module';
import { WorkspaceController, CommandCenterController, CalendarConnectionsController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { CommandCenterService } from './command-center.service';

@Module({
  imports: [WorkforceModule],
  controllers: [WorkspaceController, CommandCenterController, CalendarConnectionsController],
  providers: [WorkspaceService, CommandCenterService],
})
export class WorkspaceModule {}
