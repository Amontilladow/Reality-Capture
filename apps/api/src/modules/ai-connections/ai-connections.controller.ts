import { Controller, Get, Post, Delete, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@engineeringos/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiConnectionsService } from './ai-connections.service';
import { ConnectAiProviderDto } from './dto/connect-ai-provider.dto';

// Spec section 7: Settings > AI > "My AI Provider". Not project-scoped --
// a personal credential tied to the user's account, same reasoning as
// Developer Settings' API keys being account/company level, not
// per-project.
@ApiTags('ai-connections')
@ApiBearerAuth()
@Controller('ai-connections')
export class AiConnectionsController {
  constructor(private readonly connections: AiConnectionsService) {}

  @Get()
  @ApiOperation({ summary: "Get the current user's BYO AI connection status (never includes the key itself)" })
  async getStatus(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.connections.getStatus(u.companyId, u.id), error: null };
  }

  @Post()
  @ApiOperation({ summary: 'Connect (or replace) the current AI provider credentials -- validated before being stored' })
  async connect(@CurrentUser() u: AuthenticatedUser, @Body() dto: ConnectAiProviderDto) {
    return { data: await this.connections.connect(u.companyId, u.id, dto), error: null };
  }

  @Post('test')
  @ApiOperation({ summary: 'Re-validate the already-stored connection against the live provider' })
  async testConnection(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.connections.testConnection(u.companyId, u.id), error: null };
  }

  @Delete()
  @ApiOperation({ summary: 'Disconnect the current AI provider -- reverts to RealityCapture AI' })
  async disconnect(@CurrentUser() u: AuthenticatedUser) {
    await this.connections.disconnect(u.companyId, u.id);
    return { data: { connected: false }, error: null };
  }
}
