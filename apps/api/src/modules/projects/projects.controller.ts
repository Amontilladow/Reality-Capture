import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'List all projects for the company' })
  async findAll(@CurrentUser() u: AuthenticatedUser, @Query() query: PaginationQuery) {
    const result = await this.projects.findAll(u.companyId, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Post()
  @Roles('engineering_manager', 'project_manager', 'company_admin')
  @ApiOperation({ summary: 'Create a new project' })
  async create(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateProjectDto) {
    return { data: await this.projects.create(u.companyId, u.id, dto), error: null };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project details' })
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.projects.findOne(u.companyId, id), error: null };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update project details' })
  async update(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return { data: await this.projects.update(u.companyId, id, dto), error: null };
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Get project members' })
  async getMembers(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.projects.getMembers(u.companyId, id), error: null };
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a member to the project' })
  async addMember(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return { data: await this.projects.addMember(u.companyId, id, u.id, dto), error: null };
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a member from the project' })
  async removeMember(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Param('userId') userId: string) {
    return { data: await this.projects.removeMember(u.companyId, id, userId), error: null };
  }

  @Get(':id/hierarchy')
  @ApiOperation({ summary: 'Get full building/level hierarchy for a project' })
  async getHierarchy(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.projects.getHierarchy(u.companyId, id), error: null };
  }
}