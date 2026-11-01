import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { CurrentAuth, RateLimitBucket } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { AuthContext } from '../../core/auth.guard';
import { SyncService } from './sync.service';
import {
  syncPullQuerySchema,
  syncPushSchema,
  type SyncPullQuery,
  type SyncPushInput,
} from './sync.dto';

@Controller('sync')
@RateLimitBucket('sync')
export class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  @Get('snapshot')
  async snapshot(@CurrentAuth() auth: AuthContext) {
    return this.sync.snapshot(auth.userId);
  }

  @Post('push')
  @HttpCode(200)
  async push(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(syncPushSchema)) body: SyncPushInput,
  ) {
    return this.sync.push(auth.userId, body);
  }

  @Get('pull')
  async pull(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(syncPullQuerySchema)) query: SyncPullQuery,
  ) {
    return this.sync.pull(auth.userId, query);
  }
}
