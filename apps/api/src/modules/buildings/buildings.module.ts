import { Module } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { BuildingsController } from './buildings.controller';
import { IssuesModule } from '../issues/issues.module';
import { SnaggingModule } from '../snagging/snagging.module';

@Module({
  imports: [IssuesModule, SnaggingModule],
  controllers: [BuildingsController],
  providers: [BuildingsService],
  exports: [BuildingsService],
})
export class BuildingsModule {}