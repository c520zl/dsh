import { Controller, Get, Inject } from '@nestjs/common';
import { Public, SkipRateLimit } from '../common/decorators';
import { DatabaseService } from '../core/database.service';
import { RedisService } from '../core/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  @Public()
  @SkipRateLimit()
  @Get()
  async check(): Promise<{ status: 'ok'; database: 'ok'; redis: 'ok' }> {
    await this.database.ping();
    await this.redis.client.ping();
    return { status: 'ok', database: 'ok', redis: 'ok' };
  }
}
