import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

// Top-level (no :projectId) sibling to ReportsController, same shape as
// SubscriptionController -- company-wide data scoped only by the caller's
// own companyId, same scoping GET /projects already uses (no membership
// filter: any authenticated company user already sees every non-archived
// company project there, and this endpoint mirrors that exactly).
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class CompanyReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('company-summary')
  @ApiOperation({ summary: 'Get a lean risk/issues/snagging/RFI/QAQC summary for every project in the company, for the cross-project executive view' })
  async getCompanySummary(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getCompanySummary(u.companyId), error: null };
  }
}
