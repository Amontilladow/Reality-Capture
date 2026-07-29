import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CapturesService } from './captures.service';
import { UploadUrlDto } from './dto/upload-url.dto';
import { RegisterCaptureDto } from './dto/register-capture.dto';
import { UpdateCaptureDto } from './dto/update-capture.dto';
import { CreateHotspotDto } from './dto/create-hotspot.dto';
import { SyncCapturesDto } from './dto/sync-captures.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('captures')
@ApiBearerAuth()
@Controller('projects/:projectId/captures')
export class CapturesController {
  constructor(private readonly svc: CapturesService) {}

  @Post('upload-url')
  @ApiOperation({ summary: 'Get a presigned S3 URL for direct browser/mobile upload' })
  async getUploadUrl(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Body() dto: UploadUrlDto,
  ) {
    return { data: await this.svc.getUploadUrl(u.companyId, pid, dto), error: null };
  }

  @Post()
  @ApiOperation({ summary: 'Register a capture after direct upload to S3 completes' })
  async register(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Body() dto: RegisterCaptureDto,
  ) {
    return { data: await this.svc.register(u.companyId, pid, u.id, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List captures for a project (paginated, filterable)' })
  async findAll(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Query() query: PaginationQuery & { locationId?: string; levelId?: string; buildingId?: string; phase?: string; captureType?: string },
  ) {
    const result = await this.svc.findAll(u.companyId, pid, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full capture detail including renditions and hotspots' })
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.findOne(u.companyId, pid, id), error: null };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update capture metadata' })
  async update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Body() dto: UpdateCaptureDto,
  ) {
    return { data: await this.svc.update(u.companyId, pid, id, dto), error: null };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a capture and all its renditions from storage' })
  async delete(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('id') id: string) {
    return { data: await this.svc.delete(u.companyId, pid, id), error: null };
  }

  // ── Hotspots ──────────────────────────────────────────────────────────────
  @Post(':id/hotspots')
  @ApiOperation({ summary: 'Add a hotspot to a 360° capture' })
  async createHotspot(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreateHotspotDto) {
    return { data: await this.svc.createHotspot(u.companyId, id, u.id, dto), error: null };
  }

  @Patch(':id/hotspots/:hid')
  async updateHotspot(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Param('hid') hid: string, @Body() dto: Partial<CreateHotspotDto>) {
    return { data: await this.svc.updateHotspot(u.companyId, id, hid, dto), error: null };
  }

  @Delete(':id/hotspots/:hid')
  @HttpCode(HttpStatus.OK)
  async deleteHotspot(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Param('hid') hid: string) {
    return { data: await this.svc.deleteHotspot(u.companyId, id, hid), error: null };
  }

  // ── Viewer ────────────────────────────────────────────────────────────────
  @Get('viewer/:locationId')
  @ApiOperation({ summary: 'Get all ready captures at a location for the 360° viewer' })
  async getViewerData(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Param('locationId') lid: string) {
    return { data: await this.svc.getViewerData(u.companyId, pid, lid), error: null };
  }
}

// Mobile sync endpoint — separate controller path (not under /projects/:id)
import { Controller as Ctrl2 } from '@nestjs/common';

@ApiTags('captures')
@ApiBearerAuth()
@Ctrl2('captures')
export class CapturesSyncController {
  constructor(private readonly svc: CapturesService) {}

  @Post('sync')
  @ApiOperation({ summary: 'Batch upload captures from the mobile offline queue' })
  async sync(
    @CurrentUser() u: AuthenticatedUser,
    @Query('projectId') projectId: string,
    @Body() dto: SyncCapturesDto,
  ) {
    return { data: await this.svc.syncFromMobile(u.companyId, projectId, u.id, dto), error: null };
  }
}