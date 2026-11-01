import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { auditLog } from '../db/schema';
import { DatabaseService } from './database.service';

@Injectable()
export class AuditService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async record(input: {
    userId?: string | null;
    event: string;
    ip?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.database.db.insert(auditLog).values({
      userId: input.userId ?? null,
      event: input.event.slice(0, 64),
      ipHash: input.ip ? this.hashIp(input.ip) : null,
      metadata: input.metadata ?? {},
    });
  }

  async findForUser(userId: string, limit = 50): Promise<Array<typeof auditLog.$inferSelect>> {
    return this.database.db.select().from(auditLog).where(eq(auditLog.userId, userId)).limit(limit);
  }

  private hashIp(ip: string): string {
    return createHash('sha256').update(`${this.config.auditIpSalt}:${ip}`).digest('hex');
  }
}
