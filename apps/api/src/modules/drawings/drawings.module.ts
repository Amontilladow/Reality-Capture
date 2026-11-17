import { Module } from '@nestjs/common';
import { DrawingsService } from './drawings.service';
import { DrawingsController } from './drawings.controller';
import { IssuesModule } from '../issues/issues.module';
import { RiskModule } from '../risk/risk.module';

@Module({ imports: [IssuesModule, RiskModule], controllers: [DrawingsController], providers: [DrawingsService], exports: [DrawingsService] })
export class DrawingsModule {}