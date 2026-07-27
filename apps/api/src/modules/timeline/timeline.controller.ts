import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TimelineService } from './timeline.service';
import { CreateTimelineEntryDto } from './dto/create-entry.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('timeline')
@ApiBearerAuth()
@Controller('projects/:projectId/timeline')
export class TimelineController {
  constructor(private readonly svc: TimelineService) {}

  @Post()
  @ApiOperation({ summary: 'Add a timeline entry (links a phase, date, and optional capture to a location)' })
  async create(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateTimelineEntryDto) {
    return { data: await this.svc.create(u.companyId, pid, u.id, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'Get project timeline — all entries, filterable by phase, location, date range' })
  async getProjectTimeline(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query('phase') phase?: string,
    @Query('locationId') locationId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return { data: await this.svc.getProjectTimeline(u.companyId, pid, { phase, locationId, dateFrom, dateTo }), error: null };
  }

  @Get('phase-overview')
  @ApiOperation({ summary: 'Get phase progression overview for the dashboard' })
  async getPhaseOverview(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getPhaseOverview(u.companyId, pid), error: null };
  }

  @Get('location/:locationId')
  @ApiOperation({ summary: 'Get full capture history for one location across time — the core timeline viewer' })
  async getLocationHistory(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('locationId') lid: string) {
    return { data: await this.svc.getLocationHistory(u.companyId, pid, lid), error: null };
  }

  @Get('compare')
  @ApiOperation({ summary: 'Side-by-side comparison of two captures at the same location' })
  async compare(@CurrentUser() u: AuthenticatedUser, @Query('a') a: string, @Query('b') b: string) {
    return { data: await this.svc.getComparison(u.companyId, a, b), error: null };
  }
}