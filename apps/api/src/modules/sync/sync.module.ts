import { Module } from '@nestjs/common';
import { ListsModule } from '../lists/lists.module';
import { TagsModule } from '../tags/tags.module';
import { TasksModule } from '../tasks/tasks.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [TasksModule, ListsModule, TagsModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
