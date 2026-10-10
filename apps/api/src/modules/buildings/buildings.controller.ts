import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BuildingsService } from './buildings.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';
import { CreateLevelDto } from './dto/create-level.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireProjectPermission } from '../../common/decorators/require-project-permission.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

// Phase 6 security fix: every mutating route in this controller previously
// had no @Roles/@RequireProjectPermission at all, and BuildingsService
// contained no role/permission/membership check anywhere -- confirmed by
// the Phase 6 audit (grepped for ForbiddenException/companyRole/
// hasProjectPermission across buildings.service.ts: zero hits). Any
// authenticated company user, regardless of project membership, could
// create/rename/archive the building/level/location hierarchy of any
// project in the company. SiteRoleRestrictionGuard does correctly block
// site-restricted identities here (these routes are outside its
// issues/snag-items/drawings allowlist), but every other company role was
// unrestricted. Gated to 'manage_project_records' to match the same
// permission already required to create/edit Documents, Drawings,
// Captures, and BIM models. Reads (getLevels/getLocations) and
// convertToSnag (which already enforces its own creator-or-admin check by
// delegating to IssuesService.delete()) are deliberately left ungated,
// consistent with this platform's company-wide read-visibility model.
@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects/:projectId')
export class BuildingsController {
  constructor(private readonly svc: BuildingsService) {}

  @Post('buildings')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Add a building to a project' })
  async createBuilding(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateBuildingDto) {
    return { data: await this.svc.createBuilding(u.companyId, pid, u.id, dto), error: null };
  }

  @Patch('buildings/:bid')
  @RequireProjectPermission('manage_project_records')
  async updateBuilding(@CurrentUser() u: AuthenticatedUser, @Param('bid') bid: string, @Body() dto: UpdateBuildingDto) {
    return { data: await this.svc.updateBuilding(u.companyId, bid, dto), error: null };
  }

  @Post('buildings/:bid/levels')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Add a level to a building' })
  async createLevel(@CurrentUser() u: AuthenticatedUser, @Param('bid') bid: string, @Body() dto: CreateLevelDto) {
    return { data: await this.svc.createLevel(u.companyId, bid, dto), error: null };
  }

  @Get('buildings/:bid/levels')
  async getLevels(@CurrentUser() u: AuthenticatedUser, @Param('bid') bid: string) {
    return { data: await this.svc.getLevels(u.companyId, bid), error: null };
  }

  @Post('buildings/:bid/levels/:lid/locations')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Add a location to a level' })
  async createLocation(@CurrentUser() u: AuthenticatedUser, @Param('lid') lid: string, @Body() dto: CreateLocationDto) {
    return { data: await this.svc.createLocation(u.companyId, lid, dto), error: null };
  }

  @Get('buildings/:bid/levels/:lid/locations')
  async getLocations(@CurrentUser() u: AuthenticatedUser, @Param('lid') lid: string) {
    return { data: await this.svc.getLocations(u.companyId, lid), error: null };
  }

  // Flat route (no building/level in the path) since a floor-plan pin is a
  // location that may not have a level at all.
  @Patch('locations/:id')
  @RequireProjectPermission('manage_project_records')
  @ApiOperation({ summary: 'Rename, re-describe, or reposition a location (including a floor-plan pin)' })
  async updateLocation(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return { data: await this.svc.updateLocation(u.companyId, id, dto), error: null };
  }

  @Delete('locations/:id')
  @RequireProjectPermission('manage_project_records')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a location -- hides it and its pin, but keeps everything attached intact and recoverable' })
  async archiveLocation(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.archiveLocation(u.companyId, id), error: null };
  }

  @Post('locations/:id/convert-to-snag')
  @ApiOperation({ summary: 'Convert a pin\'s auto-created Issue into a Snag item' })
  async convertToSnag(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.convertPinToSnag(u.companyId, pid, id, u.id, u.companyRole), error: null };
  }
}