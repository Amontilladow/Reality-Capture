import { Controller, Delete, Get, HttpStatus, Post, Query, Redirect } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GmailIntegrationService } from './gmail-integration.service';
import { EmailOAuthCallbackQueryDto } from './dto/oauth-callback-query.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

// Mirrors OutlookIntegrationController (Phase 3C) exactly -- same five
// routes, same shape, same @Public() reasoning on the callback.
@ApiTags('email-integration')
@ApiBearerAuth()
@Controller('email-integration/gmail')
export class GmailIntegrationController {
  constructor(
    private readonly svc: GmailIntegrationService,
    private readonly config: ConfigService,
  ) {}

  @Get('authorize-url')
  @ApiOperation({ summary: 'Get the Google OAuth consent URL to connect the current user\'s Gmail account' })
  async getAuthorizeUrl(@CurrentUser() u: AuthenticatedUser) {
    return { data: { url: this.svc.getAuthorizeUrl(u.companyId, u.id) }, error: null };
  }

  @Public()
  @Get('callback')
  @Redirect()
  @ApiOperation({ summary: 'Google OAuth callback -- not called directly by API clients' })
  async callback(@Query() query: EmailOAuthCallbackQueryDto) {
    const frontendUrl = this.config.get<string>('app.frontendUrl');
    const redirectTo = (outcome: 'connected' | 'declined' | 'failed') =>
      ({ url: `${frontendUrl}/projects/email-settings?gmail=${outcome}`, statusCode: HttpStatus.FOUND });

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
  @ApiOperation({ summary: 'Whether the current user has connected Gmail, and its current status' })
  async getStatus(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getStatus(u.companyId, u.id), error: null };
  }

  @Post('test')
  @ApiOperation({ summary: 'Re-verify the current user\'s Gmail connection without sending any email' })
  async testConnection(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.testConnection(u.companyId, u.id), error: null };
  }

  @Delete()
  @ApiOperation({ summary: 'Disconnect the current user\'s own Gmail account' })
  async disconnect(@CurrentUser() u: AuthenticatedUser) {
    await this.svc.disconnect(u.companyId, u.id);
    return { data: { disconnected: true }, error: null };
  }
}
