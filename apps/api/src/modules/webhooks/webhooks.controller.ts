import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { SetWebhookActiveDto } from './dto/set-webhook-active.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('webhooks')
@Roles('company_admin')
export class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new outbound webhook endpoint. The signing secret is returned once, never again.' })
  async create(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateWebhookEndpointDto) {
    return { data: await this.svc.create(u.companyId, u.id, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List this company\'s webhook endpoints (never returns the signing secret)' })
  async list(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.list(u.companyId), error: null };
  }

  @Post(':endpointId/rotate-secret')
  @ApiOperation({ summary: 'Rotate a webhook endpoint\'s signing secret. The new secret is returned once, never again.' })
  async rotate(@CurrentUser() u: AuthenticatedUser, @Param('endpointId') endpointId: string) {
    return { data: await this.svc.rotate(u.companyId, endpointId), error: null };
  }

  @Patch(':endpointId')
  @ApiOperation({ summary: 'Enable or disable a webhook endpoint without deleting it' })
  async setActive(@CurrentUser() u: AuthenticatedUser, @Param('endpointId') endpointId: string, @Body() dto: SetWebhookActiveDto) {
    return { data: await this.svc.setActive(u.companyId, endpointId, dto.isActive), error: null };
  }

  @Delete(':endpointId')
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  async delete(@CurrentUser() u: AuthenticatedUser, @Param('endpointId') endpointId: string) {
    return { data: await this.svc.delete(u.companyId, endpointId), error: null };
  }

  @Get(':endpointId/deliveries')
  @ApiOperation({ summary: 'List recent delivery attempts for a webhook endpoint' })
  async listDeliveries(@CurrentUser() u: AuthenticatedUser, @Param('endpointId') endpointId: string) {
    return { data: await this.svc.listDeliveries(u.companyId, endpointId), error: null };
  }
}
