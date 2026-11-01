import { Inject, Injectable, Logger } from '@nestjs/common';
import { newId } from '../domain/ids';
import { RedisService } from './redis.service';

const TTL_SECONDS = 24 * 60 * 60;

/**
 * Idempotency-Key support for non-sync writes. The response is cached in Redis
 * for 24h; concurrent retries wait for the first request to finish.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async run<T>(userId: string, key: string | undefined, execute: () => Promise<T>): Promise<T> {
    if (!key) {
      return execute();
    }
    const normalized = key.trim();
    if (normalized.length === 0 || normalized.length > 200) {
      return execute();
    }
    const cacheKey = `todo:idem:result:${userId}:${normalized}`;
    const lockKey = `todo:idem:lock:${userId}:${normalized}`;

    const cached = await this.redis.client.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        await this.redis.client.del(cacheKey);
      }
    }

    const lock = await this.redis.client.set(lockKey, newId(), 'EX', 30, 'NX');
    if (!lock) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await delay(100);
        const result = await this.redis.client.get(cacheKey);
        if (result) {
          try {
            return JSON.parse(result) as T;
          } catch {
            break;
          }
        }
      }
      this.logger.warn(
        `Idempotency lock wait timed out for user=${userId}; executing request again`,
      );
      return execute();
    }

    try {
      const result = await execute();
      await this.redis.client.set(cacheKey, JSON.stringify(result), 'EX', TTL_SECONDS);
      return result;
    } finally {
      await this.redis.client.del(lockKey);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
