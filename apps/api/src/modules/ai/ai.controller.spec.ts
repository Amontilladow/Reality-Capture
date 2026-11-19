import { EventEmitter } from 'events';
import type { Response } from 'express';
import type { AuthenticatedUser } from '@engineeringos/types';
import { AiController } from './ai.controller';
import { AssistantQuotaExceededError, type AiService, type AskStreamOptions } from './ai.service';

const user = { id: 'u1', companyId: 'c1', companyRole: 'consultant' } as AuthenticatedUser;

// Minimal stand-in for an Express Response: records status, headers, the
// SSE frames written, and any JSON error body.
function fakeRes() {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 0,
    headers: {} as Record<string, string>,
    headersSent: false,
    writableEnded: false,
    chunks: [] as string[],
    jsonBody: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    setHeader(k: string, v: string) { res.headers[k] = v; },
    flushHeaders() { res.headersSent = true; },
    write(chunk: string) { res.chunks.push(chunk); return true; },
    end() { res.writableEnded = true; },
    json(body: unknown) { res.jsonBody = body; res.headersSent = true; res.writableEnded = true; },
  });
  return res;
}

function controllerWith(ask: (opts: AskStreamOptions) => Promise<unknown>) {
  const ai = { ask: jest.fn((_u, _p, _d, opts: AskStreamOptions) => ask(opts)) };
  return { controller: new AiController(ai as unknown as AiService), ai };
}

describe('AiController.askStream', () => {
  it('streams delta events then a done event with the final result', async () => {
    const { controller } = controllerWith(async ({ onDelta }) => {
      onDelta('Hello ');
      onDelta('world');
      return { answer: 'Hello world', toolsUsed: [], remainingQuota: { dailyUsed: 1, dailyLimit: 30 } };
    });
    const res = fakeRes();
    await controller.askStream(user, 'p1', { question: 'Summarize the project' }, res as unknown as Response);

    expect(res.headers['Content-Type']).toContain('text/event-stream');
    expect(res.chunks).toEqual([
      'event: delta\ndata: {"text":"Hello "}\n\n',
      'event: delta\ndata: {"text":"world"}\n\n',
      expect.stringContaining('event: done\ndata: {"answer":"Hello world"'),
    ]);
    expect(res.writableEnded).toBe(true);
  });

  it('returns a normal 429 JSON error when the quota is exhausted before anything was streamed', async () => {
    const { controller } = controllerWith(async () => { throw new AssistantQuotaExceededError('limit', 'daily_limit'); });
    const res = fakeRes();
    await controller.askStream(user, 'p1', { question: 'Summarize the project' }, res as unknown as Response);
    expect(res.statusCode).toBe(429);
    expect(res.jsonBody).toEqual({ data: null, error: { code: 'AI_DAILY_LIMIT_EXCEEDED', message: 'limit' } });
    expect(res.chunks).toEqual([]);
  });

  it('sends an error event when the provider fails after streaming started', async () => {
    const { controller } = controllerWith(async ({ onDelta }) => {
      onDelta('partial');
      throw new Error('upstream died');
    });
    const res = fakeRes();
    await controller.askStream(user, 'p1', { question: 'Summarize the project' }, res as unknown as Response);
    expect(res.chunks[1]).toBe('event: error\ndata: {"code":"AI_UNAVAILABLE","message":"upstream died"}\n\n');
  });

  it('aborts the provider call when the client disconnects', async () => {
    let signal: AbortSignal | undefined;
    const res = fakeRes();
    const { controller } = controllerWith(async (opts) => {
      signal = opts.signal;
      res.emit('close');
      throw new Error('aborted');
    });
    await controller.askStream(user, 'p1', { question: 'Summarize the project' }, res as unknown as Response);
    expect(signal?.aborted).toBe(true);
    expect(res.chunks).toEqual([]);
  });
});
