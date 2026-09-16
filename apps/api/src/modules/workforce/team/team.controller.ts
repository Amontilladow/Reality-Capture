import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TeamService } from './team.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('workforce')
@ApiBearerAuth()
@RequireFeature('workforce')
@Controller('workforce/team')
export class TeamController {
  constructor(private readonly svc: TeamService) {}

  @Get()
  @ApiOperation({ summary: 'List everyone in the current user\'s downward reporting chain (empty for an individual contributor)' })
  async getMyTeam(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getMyTeam(u.companyId, u.id), error: null };
  }
}
