import { Controller, Get, Post, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DrawingsService } from './drawings.service';
import { CreateDrawingDto } from './dto/create-drawing.dto';
import { LinkCaptureToDrawingDto } from './dto/link-capture.dto';
import { CreatePinDto } from './dto/create-pin.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('drawings')
@ApiBearerAuth()
@Controller('projects/:projectId/drawings')
export class DrawingsController {
  constructor(private readonly svc: DrawingsService) {}

  @Post('upload-url')
  @ApiOperation({ summary: 'Get presigned URL for drawing PDF upload' })
  async getUploadUrl(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() body: { filename: string }) {
    return { data: await this.svc.getUploadUrl(u.companyId, pid, body.filename), error: null };
  }

  @Post()
  @ApiOperation({ summary: 'Register a drawing after upload' })
  async create(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Body() dto: CreateDrawingDto) {
    return { data: await this.svc.create(u.companyId, pid, u.id, dto), error: null };
  }

  @Get()
  @ApiOperation({ summary: 'List drawings for a project or level' })
  async findAll(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Query('levelId') levelId?: string) {
    return { data: await this.svc.findAll(u.companyId, pid, levelId), error: null };
  }

  @Get('pins/search')
  @ApiOperation({ summary: 'Search pins across every drawing in the project (for linking from a BIM element)' })
  async searchProjectPins(@CurrentUser() u: AuthenticatedUser, @Param('projectId') pid: string, @Query('search') search?: string) {
    return { data: await this.svc.searchProjectPins(u.companyId, pid, search), error: null };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get drawing with all linked capture pins' })
  async findOne(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.findOne(u.companyId, id), error: null };
  }

  @Get(':id/floor-plan')
  @ApiOperation({ summary: 'Get floor plan data for the viewer — drawing + all capture pins with thumbnails' })
  async getFloorPlanData(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.getFloorPlanData(u.companyId, id), error: null };
  }

  @Post(':id/link-capture')
  @ApiOperation({ summary: 'Place a capture pin on a drawing at normalized (x,y) coordinates' })
  async linkCapture(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: LinkCaptureToDrawingDto) {
    return { data: await this.svc.linkCapture(u.companyId, id, u.id, dto), error: null };
  }

  @Delete(':id/captures/:captureId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a capture pin from a drawing' })
  async unlinkCapture(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Param('captureId') cid: string) {
    return { data: await this.svc.unlinkCapture(u.companyId, id, cid), error: null };
  }

  @Post(':id/pins')
  @ApiOperation({ summary: 'Create a pin on a drawing at normalized (x,y) coordinates — no capture required yet' })
  async createPin(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreatePinDto) {
    return { data: await this.svc.createPin(u.companyId, id, dto), error: null };
  }

  @Get(':id/pins')
  @ApiOperation({ summary: 'List pins for a drawing — one marker per place, with a capture count and latest thumbnail' })
  async getPins(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.svc.getPins(u.companyId, id), error: null };
  }
}