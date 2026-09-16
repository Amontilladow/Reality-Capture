import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportingLinesService } from './reporting-lines.service';
import { SetReportingLineDto } from './dto/set-reporting-line.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

// Assigning who-reports-to-whom is an org-structure decision, not
// something a manager should self-serve -- gated company_admin+ (unlike
// TeamController, which any authenticated user can call for their own
// downward closure).
@ApiTags('workforce')
@ApiBearerAuth()
@RequireFeature('workforce')
@Roles('company_admin')
@Controller('workforce/reporting-lines')
export class ReportingLinesController {
  constructor(private readonly svc: ReportingLinesService) {}

  @Get()
  @ApiOperation({ summary: 'List the company\'s current reporting chain' })
  async list(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.list(u.companyId), error: null };
  }

  @Post()
  @ApiOperation({ summary: 'Set (or change) one user\'s manager' })
  async upsert(@CurrentUser() u: AuthenticatedUser, @Body() dto: SetReportingLineDto) {
    return { data: await this.svc.upsert(u.companyId, u.id, dto.userId, dto.managerId), error: null };
  }
}
