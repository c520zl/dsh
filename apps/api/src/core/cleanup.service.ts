import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, isNotNull, lt } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { addDays } from '../domain/time';
import { auditLog, changeLog, processedOps, tasks, users } from '../db/schema';
import { DatabaseService } from './database.service';
import { ExportService } from '../modules/export/export.service';
import { ReminderService } from './reminder.service';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ReminderService) private readonly reminders: ReminderService,
    @Inject(ExportService) private readonly exports: ExportService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async run(): Promise<Record<string, number>> {
    const now = new Date();
    const stats: Record<string, number> = {};

    stats.reminders = await this.reminders.purgeOld();
    stats.remindersExpired = await this.reminders.expireStale();
    stats.remindersStaleProcessing = await this.reminders.resetStaleProcessing();
    stats.exports = await this.exports.purgeExpired();

    const trashCutoff = addDays(now, -this.config.trashRetentionDays);
    const deletedTasks = await this.database.db
      .delete(tasks)
      .where(and(isNotNull(tasks.deletedAt), lt(tasks.deletedAt, trashCutoff)))
      .returning({ id: tasks.id });
    stats.trashTasks = deletedTasks.length;

    const changeCutoff = addDays(now, -this.config.changeLogRetentionDays);
    const deletedChanges = await this.database.db
      .delete(changeLog)
      .where(lt(changeLog.createdAt, changeCutoff))
      .returning({ seq: changeLog.seq });
    stats.changeLog = deletedChanges.length;

    const opsCutoff = addDays(now, -this.config.processedOpsRetentionDays);
    const deletedOps = await this.database.db
      .delete(processedOps)
      .where(lt(processedOps.createdAt, opsCutoff))
      .returning({ opId: processedOps.opId });
    stats.processedOps = deletedOps.length;

    const auditCutoff = addDays(now, -this.config.auditRetentionDays);
    const deletedAudit = await this.database.db
      .delete(auditLog)
      .where(lt(auditLog.createdAt, auditCutoff))
      .returning({ id: auditLog.id });
    stats.auditLog = deletedAudit.length;

    const userCutoff = addDays(now, -30);
    const deletedUsers = await this.database.db
      .delete(users)
      .where(and(isNotNull(users.deletedAt), lt(users.deletedAt, userCutoff)))
      .returning({ id: users.id });
    stats.users = deletedUsers.length;

    this.logger.log({ stats }, 'Cleanup run finished');
    return stats;
  }
}
