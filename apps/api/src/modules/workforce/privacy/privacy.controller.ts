import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrivacyService } from './privacy.service';
import { UpdatePrivacySettingsDto } from './dto/update-privacy-settings.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('workforce')
@ApiBearerAuth()
@RequireFeature('workforce')
@Controller('workforce/privacy-settings')
export class PrivacyController {
  constructor(private readonly svc: PrivacyService) {}

  @Get()
  @ApiOperation({ summary: 'Get the company\'s workforce monitoring privacy policy' })
  async get(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.get(u.companyId), error: null };
  }

  @Patch()
  @Roles('company_admin')
  @ApiOperation({ summary: 'Update the company\'s workforce monitoring privacy policy' })
  async update(@CurrentUser() u: AuthenticatedUser, @Body() dto: UpdatePrivacySettingsDto) {
    return { data: await this.svc.update(u.companyId, u.id, dto), error: null };
  }
}
