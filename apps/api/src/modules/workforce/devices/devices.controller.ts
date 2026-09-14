import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import { EnrollDeviceDto } from './dto/enroll-device.dto';
import { HeartbeatDeviceDto } from './dto/heartbeat-device.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('workforce')
@ApiBearerAuth()
@RequireFeature('workforce')
@Controller('workforce/devices')
export class DevicesController {
  constructor(private readonly svc: DevicesService) {}

  @Post()
  @ApiOperation({ summary: 'Self-enroll a device for the current user' })
  async enroll(@CurrentUser() u: AuthenticatedUser, @Body() dto: EnrollDeviceDto) {
    return { data: await this.svc.enroll(u.companyId, u.id, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List devices (own devices, or all company devices for company_admin+)' })
  async list(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.list(u.companyId, u.id, u.companyRole), error: null };
  }

  @Post(':deviceId/heartbeat')
  @ApiOperation({ summary: 'Record a device heartbeat' })
  async heartbeat(@CurrentUser() u: AuthenticatedUser, @Param('deviceId') deviceId: string, @Body() dto: HeartbeatDeviceDto) {
    return { data: await this.svc.heartbeat(u.companyId, u.id, u.companyRole, deviceId, dto), error: null };
  }

  @Delete(':deviceId')
  @ApiOperation({ summary: 'Revoke a device' })
  async revoke(@CurrentUser() u: AuthenticatedUser, @Param('deviceId') deviceId: string) {
    return { data: await this.svc.revoke(u.companyId, u.id, u.companyRole, deviceId), error: null };
  }
}
