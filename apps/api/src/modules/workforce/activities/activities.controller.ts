import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivitiesService } from './activities.service';
import { IngestActivitiesDto } from './dto/ingest-activities.dto';
import { AttributeActivityDto } from './dto/attribute-activity.dto';
import { ActivitySummaryQueryDto } from './dto/activity-summary-query.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('workforce')
@ApiBearerAuth()
@RequireFeature('workforce')
@Controller('workforce/activities')
export class ActivitiesController {
  constructor(private readonly svc: ActivitiesService) {}

  @Post('ingest')
  @ApiOperation({ summary: 'Batch-ingest activity events from a device agent (idempotent per device+clientEventId)' })
  async ingest(@CurrentUser() u: AuthenticatedUser, @Body() dto: IngestActivitiesDto) {
    return { data: await this.svc.ingest(u.companyId, u.id, dto), error: null };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the current user\'s own activity summary' })
  async getMySummary(@CurrentUser() u: AuthenticatedUser, @Query() query: ActivitySummaryQueryDto) {
    return { data: await this.svc.getMySummary(u.companyId, u.id, query.from, query.to), error: null };
  }

  // Declared after 'me' so that literal route keeps matching
  // /workforce/activities/me -- Nest/Express register routes in class
  // declaration order, and a ':userId' route declared first would swallow
  // 'me' as if it were a userId.
  @Get(':userId')
  @ApiOperation({ summary: 'Get another user\'s activity summary (manager/leadership visibility only)' })
  async getSummaryForUser(@CurrentUser() u: AuthenticatedUser, @Param('userId') userId: string, @Query() query: ActivitySummaryQueryDto) {
    return { data: await this.svc.getMySummary(u.companyId, u.id, query.from, query.to, userId, u.companyRole), error: null };
  }

  @Post(':activityId/attribute')
  @ApiOperation({ summary: 'Manually attribute one of the current user\'s own activities to a project' })
  async attribute(@CurrentUser() u: AuthenticatedUser, @Param('activityId') activityId: string, @Body() dto: AttributeActivityDto) {
    return { data: await this.svc.attribute(u.companyId, u.id, activityId, dto.projectId), error: null };
  }
}
