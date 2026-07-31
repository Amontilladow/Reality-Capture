import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BuildingsService } from './buildings.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects/:projectId')
export class BuildingsController {
  constructor(private readonly svc: BuildingsService) {}

  @Post('buildings')
  @ApiOperation({ summary: 'Add a building to a project' })
  async createBuilding(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: { name: string; code?: string; totalLevels?: number }) {
    return { data: await this.svc.createBuilding(u.companyId, pid, u.id, dto), error: null };
  }

  @Patch('buildings/:bid')
  async updateBuilding(@CurrentUser() u: AuthenticatedUser, @Param('bid') bid: string, @Body() dto: { name?: string; phase?: string }) {
    return { data: await this.svc.updateBuilding(u.companyId, bid, dto), error: null };
  }

  @Post('buildings/:bid/levels')
  @ApiOperation({ summary: 'Add a level to a building' })
  async createLevel(@CurrentUser() u: AuthenticatedUser, @Param('bid') bid: string, @Body() dto: { name: string; elevationM?: number; levelOrder: number }) {
    return { data: await this.svc.createLevel(u.companyId, bid, dto), error: null };
  }

  @Get('buildings/:bid/levels')
  async getLevels(@CurrentUser() u: AuthenticatedUser, @Param('bid') bid: string) {
    return { data: await this.svc.getLevels(u.companyId, bid), error: null };
  }

  @Post('buildings/:bid/levels/:lid/locations')
  @ApiOperation({ summary: 'Add a location to a level' })
  async createLocation(@CurrentUser() u: AuthenticatedUser, @Param('lid') lid: string, @Body() dto: { name: string; description?: string }) {
    return { data: await this.svc.createLocation(u.companyId, lid, dto), error: null };
  }

  @Get('buildings/:bid/levels/:lid/locations')
  async getLocations(@CurrentUser() u: AuthenticatedUser, @Param('lid') lid: string) {
    return { data: await this.svc.getLocations(u.companyId, lid), error: null };
  }

  // Flat route (no building/level in the path) since a floor-plan pin is a
  // location that may not have a level at all.
  @Patch('locations/:id')
  @ApiOperation({ summary: 'Rename, re-describe, or reposition a location (including a floor-plan pin)' })
  async updateLocation(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: { name?: string; description?: string; posXNorm?: number; posYNorm?: number; elementId?: string | null },
  ) {
    return { data: await this.svc.updateLocation(u.companyId, id, dto), error: null };
  }

  @Delete('locations/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a location -- hides it and its pin, but keeps everything attached intact and recoverable' })
  async archiveLocation(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.archiveLocation(u.companyId, id), error: null };
  }
}