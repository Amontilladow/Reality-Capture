import { Controller, Delete, Get, HttpStatus, Post, Query, Redirect } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OutlookIntegrationService } from './outlook-integration.service';
import { EmailOAuthCallbackQueryDto } from './dto/oauth-callback-query.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('email-integration')
@ApiBearerAuth()
@Controller('email-integration/outlook')
export class OutlookIntegrationController {
  constructor(
    private readonly svc: OutlookIntegrationService,
    private readonly config: ConfigService,
  ) {}

  @Get('authorize-url')
  @ApiOperation({ summary: 'Get the Microsoft OAuth consent URL to connect the current user\'s Outlook mailbox' })
  async getAuthorizeUrl(@CurrentUser() u: AuthenticatedUser) {
    return { data: { url: this.svc.getAuthorizeUrl(u.companyId, u.id) }, error: null };
  }

  // Microsoft redirects the browser here directly -- no JWT bearer token,
  // no request.user, no tenant context. @Public() bypasses JwtAuthGuard the
  // same way Calendar's own callback route does; the signed `state` is the
  // actual authorization (see oauth-state.util.ts).
  @Public()
  @Get('callback')
  @Redirect()
  @ApiOperation({ summary: 'Microsoft OAuth callback -- not called directly by API clients' })
  async callback(@Query() query: EmailOAuthCallbackQueryDto) {
    const frontendUrl = this.config.get<string>('app.frontendUrl');
    const redirectTo = (outcome: 'connected' | 'declined' | 'failed') =>
      ({ url: `${frontendUrl}/projects/email-settings?outlook=${outcome}`, statusCode: HttpStatus.FOUND });

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
  @ApiOperation({ summary: 'Whether the current user has connected Outlook, and its current status' })
  async getStatus(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getStatus(u.companyId, u.id), error: null };
  }

  @Post('test')
  @ApiOperation({ summary: 'Re-verify the current user\'s Outlook connection without sending any email' })
  async testConnection(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.testConnection(u.companyId, u.id), error: null };
  }

  @Delete()
  @ApiOperation({ summary: 'Disconnect the current user\'s own Outlook mailbox' })
  async disconnect(@CurrentUser() u: AuthenticatedUser) {
    await this.svc.disconnect(u.companyId, u.id);
    return { data: { disconnected: true }, error: null };
  }
}
