import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { rateLimited } from '../common/errors';
import { RATE_LIMIT_BUCKET, SKIP_RATE_LIMIT, type RequestWithAuth } from '../common/decorators';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { RedisService } from './redis.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const bucket =
      this.reflector.getAllAndOverride<'general' | 'sync'>(RATE_LIMIT_BUCKET, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'general';
    const limit =
      bucket === 'sync' ? this.config.syncRateLimitPerMinute : this.config.rateLimitPerMinute;
    const windowSeconds = 60;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowIndex = Math.floor(nowSeconds / windowSeconds);
    const identity = request.auth?.userId ? `user:${request.auth.userId}` : `ip:${request.ip}`;
    const key = `todo:rate:${bucket}:${identity}:${windowIndex}`;

    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, windowSeconds + 1);
    }
    if (count > limit) {
      const retryAfter = windowSeconds - (nowSeconds % windowSeconds);
      throw rateLimited('请求过于频繁，请稍后重试', retryAfter);
    }
    return true;
  }
}
