import { Module } from '@nestjs/common';
import { WorkspaceController, CommandCenterController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { CommandCenterService } from './command-center.service';

@Module({
  controllers: [WorkspaceController, CommandCenterController],
  providers: [WorkspaceService, CommandCenterService],
})
export class WorkspaceModule {}
