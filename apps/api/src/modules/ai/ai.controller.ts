import { Controller, Get, Post, Body, Param, Res, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
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
  // Own bucket, same pattern as the auth routes' @Throttle override; an
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

  // Same request/response contract as POST above, delivered as Server-Sent
  // Events so the Assistant can render the answer while it is generated:
  //   event: delta  data: {"text": "..."}            (zero or more)
  //   event: done   data: <AskAssistantResult>        (exactly one, last)
  //   event: error  data: {"code": "...", "message": "..."}  (instead of done)
  // Errors raised before the first byte is written (quota exceeded, domain
  // guard failures are not errors) still return the normal JSON error
  // status, so the client can tell "rejected" from "failed mid-answer".
  @Post('stream')
  @ApiOperation({ summary: 'Ask the Engineering Assistant, streaming the answer as Server-Sent Events' })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async askStream(
    @CurrentUser() u: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() dto: AskAssistantDto,
    @Res() res: Response,
  ): Promise<void> {
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });

    const send = (event: string, data: unknown) => {
      if (!res.headersSent) {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        // Stops reverse proxies (nginx-style, incl. some PaaS edges) from
        // buffering the stream until it ends.
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await this.ai.ask(u, projectId, dto, {
        onDelta: (text) => send('delta', { text }),
        signal: abort.signal,
      });
      send('done', result);
      res.end();
    } catch (err) {
      if (abort.signal.aborted) { res.end(); return; }
      const quota = err instanceof AssistantQuotaExceededError;
      const code = quota ? (err.reason === 'daily_limit' ? 'AI_DAILY_LIMIT_EXCEEDED' : 'AI_RATE_LIMIT_EXCEEDED') : 'AI_UNAVAILABLE';
      const message = err instanceof Error ? err.message : 'The AI assistant is temporarily unavailable. Please try again shortly.';
      if (!res.headersSent) {
        const status = quota ? HttpStatus.TOO_MANY_REQUESTS
          : err instanceof HttpException ? err.getStatus() : HttpStatus.SERVICE_UNAVAILABLE;
        res.status(status).json({ data: null, error: { code, message } });
        return;
      }
      send('error', { code, message });
      res.end();
    }
  }

  @Get('quota')
  @ApiOperation({ summary: "Get the current user's remaining AI assistant quota for today" })
  async quota(@CurrentUser() u: AuthenticatedUser) {
    const remaining = await this.ai.getRemainingQuota(u);
    return { data: remaining, error: null };
  }
}
