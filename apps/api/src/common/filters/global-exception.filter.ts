import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const STATUS_CODE_FALLBACK: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx    = host.switchToHttp();
    const res    = ctx.getResponse<Response>();
    const req    = ctx.getRequest<Request>();
    const reqId  = req.headers['x-request-id'] as string | undefined;

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = exception instanceof HttpException
      ? exception.getResponse()
      : null;

    // Don't log 4xx as errors — they're expected client mistakes
    if (status >= 500) {
      this.logger.error(`[${req.method}] ${req.url} -> ${status}`, exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({
      data: null,
      error: {
        code: typeof exceptionResponse === 'object' && exceptionResponse !== null && 'code' in exceptionResponse
          ? (exceptionResponse as Record<string, unknown>).code
          : (STATUS_CODE_FALLBACK[status] ?? 'INTERNAL_ERROR'),
        message: typeof exceptionResponse === 'object' && exceptionResponse !== null && 'message' in exceptionResponse
          ? (exceptionResponse as Record<string, unknown>).message
          : 'An unexpected error occurred.',
        ...(typeof exceptionResponse === 'object' && exceptionResponse !== null && 'details' in exceptionResponse
          ? { details: (exceptionResponse as Record<string, unknown>).details }
          : {}),
        requestId: reqId,
      },
    });
  }
}