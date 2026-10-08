import { Controller, Get, Post, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '@engineeringos/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiService, AssistantQuotaExceededError } from './ai.service';
import { AskAssistantDto } from './dto/ask-assistant.dto';

@ApiTags('assistant')
@ApiBearerAuth()
@Controller('projects/:projectId/assistant')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post()
  @ApiOperation({ summary: 'Ask the RealityCapture Engineering Assistant a question about this project' })
  // Own bucket, same pattern as the auth routes' @Throttle override -- an
  // LLM call costs real money per request, so the generic 100/min default
  // bucket is far too loose here. This is a coarse abuse backstop on top
  // of (not instead of) AiUsageService's per-role daily/per-minute quotas,
  // which are the limits that actually vary by role.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async ask(@CurrentUser() u: AuthenticatedUser, @Param('projectId') projectId: string, @Body() dto: AskAssistantDto) {
    try {
      const result = await this.ai.ask(u, projectId, dto);
      return { data: result, error: null };
    } catch (err) {
      if (err instanceof AssistantQuotaExceededError) {
        throw new HttpException(
          { data: null, error: { code: err.reason === 'daily_limit' ? 'AI_DAILY_LIMIT_EXCEEDED' : 'AI_RATE_LIMIT_EXCEEDED', message: err.message } },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw err; // already an HttpException (ServiceUnavailableException) from AiService.ask()'s own catch
    }
  }

  @Get('quota')
  @ApiOperation({ summary: "Get the current user's remaining AI assistant quota for today" })
  async quota(@CurrentUser() u: AuthenticatedUser) {
    const remaining = await this.ai.getRemainingQuota(u);
    return { data: remaining, error: null };
  }
}
