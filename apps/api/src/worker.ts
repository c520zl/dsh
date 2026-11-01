import './config/bootstrap';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from './config/config';
import { CleanupService } from './core/cleanup.service';
import { ExportService } from './modules/export/export.service';
import { ReminderService } from './core/reminder.service';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const logger = app.get(Logger);
  const config = app.get<AppConfig>(APP_CONFIG);
  const reminders = app.get(ReminderService);
  const exportsService = app.get(ExportService);
  const cleanup = app.get(CleanupService);

  let stopping = false;
  const timers: NodeJS.Timeout[] = [];

  const schedule = (name: string, intervalMs: number, task: () => Promise<unknown>): void => {
    let busy = false;
    const tick = async (): Promise<void> => {
      if (busy || stopping) {
        return;
      }
      busy = true;
      const startedAt = Date.now();
      try {
        const result = await task();
        logger.log(`${name} finished in ${Date.now() - startedAt}ms`, { result });
      } catch (error) {
        logger.error({ err: error }, `${name} failed`);
      } finally {
        busy = false;
      }
    };
    void tick();
    timers.push(setInterval(() => void tick(), intervalMs));
  };

  schedule('reminders', config.reminderTickMs, async () => {
    await reminders.resetStaleProcessing();
    await reminders.expireStale();
    return { dispatched: await reminders.dispatchDue(200) };
  });

  schedule('exports', config.exportTickMs, async () => {
    await exportsService.resetStale();
    return { processed: await exportsService.processPending(5) };
  });

  schedule('cleanup', config.cleanupTickMs, () => cleanup.run());

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.log(`Worker received ${signal}; shutting down`);
    timers.forEach((timer) => clearInterval(timer));
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.log(
    `Todo worker started (reminders every ${config.reminderTickMs}ms, exports every ${config.exportTickMs}ms, cleanup every ${config.cleanupTickMs}ms)`,
  );
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal worker startup error', error);
  process.exit(1);
});
