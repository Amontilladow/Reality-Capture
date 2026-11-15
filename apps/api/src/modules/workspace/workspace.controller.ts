import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';
import { WorkspaceService } from './workspace.service';
import { CommandCenterService } from './command-center.service';
import { CreateUserTaskDto, UpdateUserTaskDto, SaveItemDto, UpdatePreferencesDto, SAVE_TYPES } from './dto/workspace.dto';

// The caller's own workspace. Every route acts on the authenticated user
// only; there is no user id parameter anywhere, so one user can never read
// or change another's tasks, saved items or preferences.
@ApiTags('workspace')
@ApiBearerAuth()
@Controller('me')
export class WorkspaceController {
  constructor(private readonly svc: WorkspaceService) {}

  @Get('preferences')
  async getPreferences(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getPreferences(u.companyId, u.id, u.companyRole), error: null };
  }

  @Patch('preferences')
  async updatePreferences(@CurrentUser() u: AuthenticatedUser, @Body() dto: UpdatePreferencesDto) {
    return { data: await this.svc.updatePreferences(u.companyId, u.id, dto, u.companyRole), error: null };
  }

  @Get('tasks')
  async listTasks(@CurrentUser() u: AuthenticatedUser, @Query('status') status?: string, @Query('kind') kind?: string, @Query('projectId') projectId?: string) {
    return { data: await this.svc.listTasks(u.companyId, u.id, { status, kind, projectId: projectId || undefined }), error: null };
  }

  @Post('tasks')
  async createTask(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateUserTaskDto) {
    return { data: await this.svc.createTask(u.companyId, u.id, dto), error: null };
  }

  @Patch('tasks/:id')
  async updateTask(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserTaskDto) {
    return { data: await this.svc.updateTask(u.companyId, u.id, id, dto), error: null };
  }

  @Delete('tasks/:id')
  async deleteTask(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.deleteTask(u.companyId, u.id, id), error: null };
  }

  @Get('saved')
  async listSaved(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.listSaved(u.companyId, u.id), error: null };
  }

  @Post('saved')
  async save(@CurrentUser() u: AuthenticatedUser, @Body() dto: SaveItemDto) {
    return { data: await this.svc.saveItem(u.companyId, u.id, dto), error: null };
  }

  @Delete('saved/:itemType/:itemId')
  async unsave(@CurrentUser() u: AuthenticatedUser, @Param('itemType') itemType: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    if (!SAVE_TYPES.includes(itemType)) throw new BadRequestException('Unknown item type');
    return { data: await this.svc.removeSaved(u.companyId, u.id, itemType, itemId), error: null };
  }

  @Get('agenda')
  @ApiOperation({ summary: 'Calendar items between two dates (YYYY-MM-DD), in the caller\'s time zone' })
  async agenda(@CurrentUser() u: AuthenticatedUser, @Query('from') from: string, @Query('to') to: string, @Query('projectId') projectId?: string, @Query('tz') tz?: string) {
    return { data: await this.svc.agenda(u.companyId, u.id, { from, to, projectId: projectId || undefined, tz }), error: null };
  }

  @Get('priorities')
  @ApiOperation({ summary: "Today's priorities, ranked by documented rules" })
  async priorities(@CurrentUser() u: AuthenticatedUser, @Query('projectId') projectId?: string, @Query('tz') tz?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? '7', 10) || 7, 1), 50);
    return { data: await this.svc.priorities(u.companyId, u.id, tz, projectId || undefined, n), error: null };
  }

  @Get('workspace')
  async workspace(@CurrentUser() u: AuthenticatedUser, @Query('projectId') projectId?: string, @Query('tz') tz?: string) {
    return { data: await this.svc.workspace(u.companyId, u.id, tz, projectId || undefined), error: null };
  }

  @Get('search')
  async search(@CurrentUser() u: AuthenticatedUser, @Query('q') q = '') {
    return { data: await this.svc.search(u.companyId, u.id, q.slice(0, 100)), error: null };
  }
}

// Under /projects/:projectId so every project guard applies unchanged.
@ApiTags('workspace')
@ApiBearerAuth()
@Controller('projects/:projectId/command-center')
export class CommandCenterController {
  constructor(private readonly svc: CommandCenterService) {}

  @Get()
  async summary(@CurrentUser() u: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string, @Query('tz') tz?: string) {
    return { data: await this.svc.summary(u.companyId, u.id, projectId, tz), error: null };
  }
}
