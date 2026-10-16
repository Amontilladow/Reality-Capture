import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SubmittalsService } from './submittals.service';
import { CreateSubmittalDto } from './dto/create-submittal.dto';
import { UpdateSubmittalDto } from './dto/update-submittal.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import { RequireCategoryAction } from '../../common/decorators/require-category-action.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('submittals')
@ApiBearerAuth()
@Controller('projects/:projectId/submittals')
export class SubmittalsController {
  constructor(private readonly svc: SubmittalsService) {}

  // Previously ungated -- the owner's org-category matrix ("Document
  // Approvals") scopes submittal creation to Construction Team/Document
  // Control/Subcontractor (and Engineering Manager, always); Management/
  // Engineering Team/QAQC Team are now genuinely restricted here (they hold
  // view/approve, not create). No fallbackPermissions -- no discretionary
  // grant for "create a submittal" existed to preserve.
  @Post()
  @RequireCategoryAction('document_approvals', 'create')
  @ApiOperation({ summary: 'Create a new submittal' })
  async create(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateSubmittalDto) {
    return { data: await this.svc.create(u.companyId, pid, u.id, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List submittals with filtering and pagination' })
  async findAll(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query() query: PaginationQuery & { status?: string; priority?: string },
  ) {
    const result = await this.svc.findAll(u.companyId, pid, query, u.id);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get submittal count summary' })
  async getSummary(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string) {
    return { data: await this.svc.getSummary(u.companyId, pid, u.id), error: null };
  }

  @Get(':id')
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.findOne(u.companyId, pid, id, u.id), error: null };
  }

  // 'edit' -- the owner's matrix gives Document Control C,V,E,X here;
  // Management/Engineering Team hold 'approve' instead, which this generic
  // field-edit PATCH doesn't represent (this module has no distinct
  // review/approve workflow endpoint to gate that action on -- flagged in
  // this sprint's own report as a gap relative to the matrix's intent).
  @Patch(':id')
  @RequireCategoryAction('document_approvals', 'edit', 'manage_project_records')
  async update(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string, @Body() dto: UpdateSubmittalDto) {
    return { data: await this.svc.update(u.companyId, pid, id, u.id, dto), error: null };
  }

  @Delete(':id')
  @RequireProjectPermission('manage_project_records')
  @HttpCode(HttpStatus.OK)
  async delete(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.delete(u.companyId, pid, id), error: null };
  }
}
