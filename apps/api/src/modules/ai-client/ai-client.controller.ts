import { Controller, Post, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AiClientService } from './ai-client.service';
import { AskAssistantDto } from './dto/ask-assistant.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('assistant')
@ApiBearerAuth()
@Controller('projects/:projectId/assistant')
export class AiClientController {
  constructor(private readonly aiClient: AiClientService) {}

  @Post()
  @ApiOperation({ summary: 'Ask the AI assistant a question about this project' })
  async ask(@CurrentUser() u: AuthenticatedUser, @Param('projectId') projectId: string, @Body() dto: AskAssistantDto) {
    try {
      // company_id always comes from the authenticated session, never the
      // client -- the AI service scopes every vector search by it, so a
      // client-supplied value here would be a cross-tenant data leak.
      const result = await this.aiClient.ask(u.companyId, projectId, dto.question, dto.conversationHistory);
      return { data: result, error: null };
    } catch (err) {
      // The AI service being down/slow shouldn't look like "your question
      // broke something" -- surface a clear, specific failure instead of a
      // generic 500.
      throw new HttpException(
        { data: null, error: { code: 'AI_SERVICE_UNAVAILABLE', message: 'The AI assistant is temporarily unavailable. Please try again shortly.' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
