import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './task.service';

@Module({
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
