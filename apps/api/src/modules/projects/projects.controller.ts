import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { BrandingUploadUrlDto } from './dto/branding-upload-url.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { CreatePermissionGrantDto } from './dto/create-permission-grant.dto';
import { UpsertOrganizationDto } from './dto/upsert-organization.dto';
import { OrganizationLogoUploadUrlDto } from './dto/organization-logo-upload-url.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import type { AuthenticatedUser, PaginationQuery, ProjectPermission } from '@engineeringos/types';

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
  @Roles('super_admin', 'company_admin')
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

  @Post(':id/branding/upload-url')
  @ApiOperation({ summary: "Get a presigned URL for uploading this project's logo or stamp" })
  async getBrandingUploadUrl(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: BrandingUploadUrlDto) {
    return { data: await this.projects.getBrandingUploadUrl(u.companyId, id, dto.filename, dto.sizeBytes, dto.kind), error: null };
  }

  // ── Project organizations (Phase 4) ─────────────────────────────────────
  // Writes are gated on 'manage_team' -- there's no dedicated "manage
  // project settings" permission; this is the closest existing semantic
  // fit for project-level administrative configuration, and matches
  // ManageMembersModal already being where manage_team grant-holders
  // configure the team. The read below is deliberately NOT gated -- same
  // convention as RFI attachments' GET :id/attachments: displaying
  // already-configured branding is not a sensitive action, and every
  // project member viewing an RFI needs to see its organization header,
  // not just manage_team holders. Gating the read would silently blank
  // out the whole header for everyone else, defeating the feature.
  @Get(':id/organizations')
  @ApiOperation({ summary: "List this project's configured stakeholder organizations" })
  async getOrganizations(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.projects.getOrganizations(u.companyId, id), error: null };
  }

  @Put(':id/organizations/:slot')
  @RequireProjectPermission('manage_team')
  @ApiOperation({ summary: "Configure one of this project's 5 stakeholder organization slots" })
  async upsertOrganization(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Param('slot') slot: string,
    @Body() dto: UpsertOrganizationDto,
  ) {
    return { data: await this.projects.upsertOrganization(u.companyId, id, slot, dto), error: null };
  }

  @Post(':id/organizations/:slot/logo-upload-url')
  @RequireProjectPermission('manage_team')
  @ApiOperation({ summary: "Get a presigned URL for uploading an organization slot's logo" })
  async getOrganizationLogoUploadUrl(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Param('slot') slot: string,
    @Body() dto: OrganizationLogoUploadUrlDto,
  ) {
    return { data: await this.projects.getOrganizationLogoUploadUrl(u.companyId, id, slot, dto.filename, dto.sizeBytes), error: null };
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Get project members' })
  async getMembers(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.projects.getMembers(u.companyId, id), error: null };
  }

  @Post(':id/members')
  @RequireProjectPermission('manage_team')
  @ApiOperation({ summary: 'Add a member to the project' })
  async addMember(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return { data: await this.projects.addMember(u.companyId, id, u.id, dto), error: null };
  }

  @Delete(':id/members/:userId')
  @RequireProjectPermission('manage_team')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a member from the project' })
  async removeMember(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Param('userId') userId: string) {
    return { data: await this.projects.removeMember(u.companyId, id, userId), error: null };
  }

  @Get(':id/permission-grants')
  @Roles('super_admin')
  @ApiOperation({ summary: "List a project's per-project permission grants" })
  async getPermissionGrants(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.projects.getPermissionGrants(u.companyId, id), error: null };
  }

  @Post(':id/permission-grants')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Grant a company_admin a specific permission on this project' })
  async grantPermission(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreatePermissionGrantDto) {
    return { data: await this.projects.grantPermission(u.companyId, id, u.id, dto), error: null };
  }

  @Delete(':id/permission-grants/:userId/:permission')
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a permission grant' })
  async revokePermission(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Param('permission') permission: ProjectPermission,
  ) {
    return { data: await this.projects.revokePermission(u.companyId, id, userId, permission), error: null };
  }

  @Get(':id/hierarchy')
  @ApiOperation({ summary: 'Get full building/level hierarchy for a project' })
  async getHierarchy(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.projects.getHierarchy(u.companyId, id), error: null };
  }
}