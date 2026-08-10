import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { QaService } from './qa.service';
import { CreateQaInspectionDto } from './dto/create-qa-inspection.dto';
import { UpdateQaInspectionDto } from './dto/update-qa-inspection.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('qa')
@ApiBearerAuth()
@Controller('projects/:projectId/qa-inspections')
export class QaController {
  constructor(private readonly svc: QaService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new QA/QC inspection' })
  async create(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateQaInspectionDto) {
    return { data: await this.svc.create(u.companyId, pid, u.id, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List QA/QC inspections with filtering and pagination' })
  async findAll(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query() query: PaginationQuery & { status?: string },
  ) {
    const result = await this.svc.findAll(u.companyId, pid, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get QA/QC inspection count summary' })
  async getSummary(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getSummary(u.companyId, pid), error: null };
  }

  @Get(':id')
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.findOne(u.companyId, pid, id), error: null };
  }

  @Patch(':id')
  @RequireProjectPermission('manage_project_records')
  async update(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string, @Body() dto: UpdateQaInspectionDto) {
    return { data: await this.svc.update(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Delete(':id')
  @RequireProjectPermission('manage_project_records')
  @HttpCode(HttpStatus.OK)
  async delete(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.delete(u.companyId, pid, id), error: null };
  }
}
