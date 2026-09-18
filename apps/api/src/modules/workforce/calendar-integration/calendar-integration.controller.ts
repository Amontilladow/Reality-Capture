import { Controller, Delete, Get, HttpStatus, Query, Redirect } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CalendarIntegrationService } from './calendar-integration.service';
import { OAuthCallbackQueryDto } from './dto/oauth-callback-query.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('workforce')
@ApiBearerAuth()
@RequireFeature('workforce')
@Controller('workforce/calendar-integration/google-calendar')
export class CalendarIntegrationController {
  constructor(
    private readonly svc: CalendarIntegrationService,
    private readonly config: ConfigService,
  ) {}

  @Get('authorize-url')
  @ApiOperation({ summary: 'Get the Google OAuth consent URL to connect the current user\'s calendar' })
  async getAuthorizeUrl(@CurrentUser() u: AuthenticatedUser) {
    return { data: { url: this.svc.getAuthorizeUrl(u.companyId, u.id) }, error: null };
  }

  // Google redirects the browser here directly -- there is no JWT bearer
  // token on this request, no request.user, no tenant context. @Public()
  // bypasses JwtAuthGuard/SubscriptionGuard/etc. (see their own isPublic
  // checks) so this route is reachable at all; the actual authorization is
  // the signed `state` parameter itself (see oauth-state.util.ts).
  @Public()
  @Get('callback')
  @Redirect()
  @ApiOperation({ summary: 'Google OAuth callback -- not called directly by API clients' })
  async callback(@Query() query: OAuthCallbackQueryDto) {
    const frontendUrl = this.config.get<string>('app.frontendUrl');
    const redirectTo = (outcome: 'connected' | 'declined' | 'failed') =>
      ({ url: `${frontendUrl}/workforce?calendar=${outcome}`, statusCode: HttpStatus.FOUND });

    if (query.error || !query.code || !query.state) {
      return redirectTo(query.error === 'access_denied' ? 'declined' : 'failed');
    }

    try {
      await this.svc.handleCallback(query.code, query.state);
      return redirectTo('connected');
    } catch {
      return redirectTo('failed');
    }
  }

  @Get('status')
  @ApiOperation({ summary: 'Whether the current user has connected Google Calendar' })
  async getStatus(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getStatus(u.companyId, u.id), error: null };
  }

  @Delete()
  @ApiOperation({ summary: 'Disconnect the current user\'s Google Calendar' })
  async disconnect(@CurrentUser() u: AuthenticatedUser) {
    await this.svc.disconnect(u.companyId, u.id);
    return { data: { disconnected: true }, error: null };
  }

  @Get('events/today')
  @ApiOperation({ summary: 'The current user\'s calendar events for today (live read, not persisted into activities)' })
  async getTodayEvents(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getTodayEvents(u.companyId, u.id), error: null };
  }
}
