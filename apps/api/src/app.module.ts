import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AllExceptionsFilter } from './common/error.filter';
import { AuthGuard } from './core/auth.guard';
import { CoreModule } from './core/core.module';
import { HealthController } from './core/health.controller';
import { RateLimitGuard } from './core/rate-limit.guard';
import { AuthModule } from './modules/auth/auth.module';
import { DevicesModule } from './modules/devices/devices.module';
import { ExportModule } from './modules/export/export.module';
import { ListsModule } from './modules/lists/lists.module';
import { MeModule } from './modules/me/me.module';
import { SyncModule } from './modules/sync/sync.module';
import { TagsModule } from './modules/tags/tags.module';
import { TasksModule } from './modules/tasks/tasks.module';

@Module({
  imports: [
    CoreModule,
    AuthModule,
    MeModule,
    DevicesModule,
    ListsModule,
    TasksModule,
    TagsModule,
    SyncModule,
    ExportModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
