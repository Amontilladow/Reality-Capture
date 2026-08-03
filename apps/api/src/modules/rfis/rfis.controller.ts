import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RfisService } from './rfis.service';
import { CreateRfiDto } from './dto/create-rfi.dto';
import { UpdateRfiDto } from './dto/update-rfi.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('rfis')
@ApiBearerAuth()
@Controller('projects/:projectId/rfis')
export class RfisController {
  constructor(private readonly svc: RfisService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new RFI' })
  async create(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateRfiDto) {
    return { data: await this.svc.create(u.companyId, pid, u.id, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List RFIs with filtering and pagination' })
  async findAll(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query() query: PaginationQuery & { status?: string; priority?: string },
  ) {
    const result = await this.svc.findAll(u.companyId, pid, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get RFI count summary' })
  async getSummary(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getSummary(u.companyId, pid), error: null };
  }

  @Get(':id')
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.findOne(u.companyId, pid, id), error: null };
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string, @Body() dto: UpdateRfiDto) {
    return { data: await this.svc.update(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.delete(u.companyId, pid, id), error: null };
  }
}
