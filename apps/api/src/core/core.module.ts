import { Global, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '../config/config.module';
import { AuditService } from './audit.service';
import { AuthGuard } from './auth.guard';
import { ChangeLogService } from './change-log.service';
import { CleanupService } from './cleanup.service';
import { DatabaseService } from './database.service';
import { IdempotencyService } from './idempotency.service';
import { ProvisioningService } from './provisioning.service';
import { PushService } from './push.service';
import { RateLimitGuard } from './rate-limit.guard';
import { RedisService } from './redis.service';
import { ReminderService } from './reminder.service';
import { TokenService } from './token.service';
import { ExportService } from '../modules/export/export.service';

const CORE_PROVIDERS = [
  DatabaseService,
  RedisService,
  TokenService,
  AuditService,
  ProvisioningService,
  IdempotencyService,
  ChangeLogService,
  PushService,
  ReminderService,
  ExportService,
  CleanupService,
  AuthGuard,
  RateLimitGuard,
];

@Global()
@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          censor: '[redacted]',
        },
        autoLogging: {
          ignore: (req) => req.url === '/v1/health',
        },
      },
    }),
  ],
  providers: CORE_PROVIDERS,
  exports: CORE_PROVIDERS,
})
export class CoreModule {}
