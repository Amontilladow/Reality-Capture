import { Module } from '@nestjs/common';
import { DrawingsService } from './drawings.service';
import { DrawingsController } from './drawings.controller';
import { IssuesModule } from '../issues/issues.module';

@Module({ imports: [IssuesModule], controllers: [DrawingsController], providers: [DrawingsService], exports: [DrawingsService] })
export class DrawingsModule {}