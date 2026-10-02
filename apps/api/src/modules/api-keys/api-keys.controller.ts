import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

// Company-wide (not per-project) administration of Public API credentials --
// gated by CompanyRole via RolesGuard, same mechanism as every other
// company-admin-only action in this app, not ProjectPermissionGuard (which
// is for per-project capabilities and doesn't apply here).
@ApiTags('public-api')
@ApiBearerAuth()
@Controller('api-keys')
@Roles('company_admin')
export class ApiKeysController {
  constructor(private readonly svc: ApiKeysService) {}

  @Post()
  @ApiOperation({ summary: 'Generate a new Public API key for this company. The full secret is returned once, never again.' })
  async create(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateApiKeyDto) {
    return { data: await this.svc.create(u.companyId, u.id, dto.name), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List this company\'s Public API keys (never returns the secret)' })
  async list(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.list(u.companyId), error: null };
  }

  @Delete(':keyId')
  @ApiOperation({ summary: 'Revoke a Public API key' })
  async revoke(@CurrentUser() u: AuthenticatedUser, @Param('keyId') keyId: string) {
    return { data: await this.svc.revoke(u.companyId, keyId, u.id), error: null };
  }
}
