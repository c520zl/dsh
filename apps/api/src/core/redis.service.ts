import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import IORedis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: IORedis;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.client = new IORedis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      connectionName: 'todo-api',
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
