import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseUUIDPipe, BadRequestException, HttpStatus, Redirect } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';
import { CalendarIntegrationService, type CalendarProvider } from '../workforce/calendar-integration/calendar-integration.service';
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

// Connect the user's own Google or Outlook calendar (read-only), so their
// meetings show on My calendar. Tokens are stored encrypted, per user, in
// the same table the Workforce Google connection uses.
const PROVIDER_BY_SLUG: Record<string, CalendarProvider> = { google: 'google_calendar', outlook: 'outlook_calendar' };
function providerOf(slug: string): CalendarProvider {
  const p = PROVIDER_BY_SLUG[slug];
  if (!p) throw new BadRequestException('Unknown calendar provider');
  return p;
}

@ApiTags('workspace')
@ApiBearerAuth()
@Controller('me/calendar-connections')
export class CalendarConnectionsController {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly calendars: CalendarIntegrationService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: "The caller's calendar connections, and which providers this deployment offers" })
  async list(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.workspace.calendarConnections(u.companyId, u.id), error: null };
  }

  @Get(':provider/authorize-url')
  async authorizeUrl(@CurrentUser() u: AuthenticatedUser, @Param('provider') slug: string) {
    return { data: { url: this.calendars.getAuthorizeUrl(u.companyId, u.id, providerOf(slug), 'calendar') }, error: null };
  }

  @Delete(':provider')
  async disconnect(@CurrentUser() u: AuthenticatedUser, @Param('provider') slug: string) {
    await this.calendars.disconnect(u.companyId, u.id, providerOf(slug));
    return { data: { disconnected: true }, error: null };
  }

  // Microsoft redirects the browser here (no JWT); the signed state is the
  // authorization, exactly as in the Workforce Google callback. Google
  // connections come back through that existing callback instead.
  @Public()
  @Get('outlook/callback')
  @Redirect()
  @ApiOperation({ summary: 'Microsoft OAuth callback -- not called directly by API clients' })
  async outlookCallback(@Query('code') code?: string, @Query('state') state?: string, @Query('error') error?: string) {
    const frontendUrl = this.config.get<string>('app.frontendUrl');
    const to = (outcome: 'connected' | 'declined' | 'failed') =>
      ({ url: `${frontendUrl}/projects/my-calendar?calendar=${outcome}&provider=outlook_calendar`, statusCode: HttpStatus.FOUND });
    if (error || !code || !state) return to(error === 'access_denied' ? 'declined' : 'failed');
    try {
      await this.calendars.handleCallback(code, state, 'outlook_calendar');
      return to('connected');
    } catch {
      return to('failed');
    }
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
