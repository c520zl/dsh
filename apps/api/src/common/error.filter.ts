import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ApiError, type ErrorCode } from './errors';

interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const requestId = String(request.id ?? 'unknown');

    let status = 500;
    let code: ErrorCode = 'INTERNAL';
    let message = '服务端错误';
    let details: Record<string, unknown> | undefined;
    const headers: Record<string, string> = {};

    if (exception instanceof ApiError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
      Object.assign(headers, exception.headers);
    } else if (exception instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = '参数校验失败';
      details = {
        issues: exception.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = statusToCode(status);
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message as string) || exception.message;
      if (Array.isArray(message)) {
        details = { issues: message };
        message = '参数校验失败';
      }
      if (status === 404 && message === 'Cannot GET /') {
        message = '资源不存在';
      }
    } else {
      this.logger.error(
        { requestId, err: exception },
        'Unhandled exception while processing request',
      );
      if (process.env.NODE_ENV !== 'production') {
        details = { reason: exception instanceof Error ? exception.message : String(exception) };
      }
    }

    headers['x-request-id'] = requestId;
    if (status === 429 && !headers['Retry-After']) {
      headers['Retry-After'] = '60';
    }

    const body: ErrorBody = {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        requestId,
      },
    };

    void response.status(status).headers(headers).send(body);
  }
}

function statusToCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'VERSION_CONFLICT';
    case 410:
      return 'CURSOR_EXPIRED';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL';
  }
}
