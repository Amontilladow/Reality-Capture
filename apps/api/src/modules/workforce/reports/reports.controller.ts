import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { ActivitySummaryQueryDto } from '../activities/dto/activity-summary-query.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('workforce')
@ApiBearerAuth()
@RequireFeature('workforce')
@Controller('workforce/reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('company-summary')
  @Roles('company_admin')
  @ApiOperation({ summary: 'Company-wide tracked/productive time per active user for a period (admin only)' })
  async getCompanySummary(@CurrentUser() u: AuthenticatedUser, @Query() query: ActivitySummaryQueryDto) {
    return { data: await this.svc.getCompanySummary(u.companyId, query.from, query.to), error: null };
  }
}
