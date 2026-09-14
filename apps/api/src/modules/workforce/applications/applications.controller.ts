import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('workforce')
@ApiBearerAuth()
@RequireFeature('workforce')
@Controller('workforce/applications')
export class ApplicationsController {
  constructor(private readonly svc: ApplicationsService) {}

  @Get()
  @ApiOperation({ summary: 'List the company application registry' })
  async list(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.list(u.companyId), error: null };
  }

  @Post()
  @Roles('company_admin')
  @ApiOperation({ summary: 'Create an application registry entry' })
  async create(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateApplicationDto) {
    return { data: await this.svc.create(u.companyId, u.id, dto), error: null };
  }

  @Patch(':id')
  @Roles('company_admin')
  @ApiOperation({ summary: 'Update an application registry entry' })
  async update(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateApplicationDto) {
    return { data: await this.svc.update(u.companyId, id, dto), error: null };
  }

  @Delete(':id')
  @Roles('company_admin')
  @ApiOperation({ summary: 'Deactivate an application registry entry' })
  async deactivate(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.deactivate(u.companyId, id), error: null };
  }
}
