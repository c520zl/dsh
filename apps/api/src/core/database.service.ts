import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { schema } from '../db/schema';

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly sql: postgres.Sql;
  readonly db: Database;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.sql = postgres(config.databaseUrl, {
      max: config.databasePool,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => undefined,
    });
    this.db = drizzle(this.sql, { schema });
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  async ping(): Promise<void> {
    await this.sql`select 1`;
  }
}
