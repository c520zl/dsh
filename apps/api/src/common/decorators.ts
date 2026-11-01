import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthContext } from '../core/auth.guard';

export const PUBLIC_ROUTE = 'todo:public';
export const SKIP_RATE_LIMIT = 'todo:skip-rate-limit';
export const RATE_LIMIT_BUCKET = 'todo:rate-limit-bucket';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RATE_LIMIT, true);

export const RateLimitBucket = (bucket: 'general' | 'sync'): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_BUCKET, bucket);

export interface RequestWithAuth extends FastifyRequest {
  auth?: AuthContext;
}

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<RequestWithAuth>();
    if (!request.auth) {
      throw new Error('CurrentAuth used on a route without authentication');
    }
    return request.auth;
  },
);
