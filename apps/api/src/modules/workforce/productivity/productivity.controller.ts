import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductivityService } from './productivity.service';
import { ProductivityQueryDto } from './dto/productivity-query.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('workforce')
@ApiBearerAuth()
@RequireFeature('workforce')
@Controller('workforce/productivity')
export class ProductivityController {
  constructor(private readonly svc: ProductivityService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the current user\'s own explainable productivity score for a period (always includes factors)' })
  async getMyScore(@CurrentUser() u: AuthenticatedUser, @Query() query: ProductivityQueryDto) {
    // An explicit from/to range (e.g. matching the activity summary's own
    // window) takes precedence over the day/week calendar shortcut below.
    if (query.from && query.to) {
      return { data: await this.svc.getMyScoreForRange(u.companyId, u.id, query.from, query.to), error: null };
    }
    const periodType = query.periodType ?? 'week';
    const periodStart = query.periodStart ?? new Date().toISOString();
    return { data: await this.svc.getMyScore(u.companyId, u.id, periodType, periodStart), error: null };
  }
}
