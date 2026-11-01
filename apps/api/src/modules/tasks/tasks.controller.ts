import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth } from '../../common/decorators';
import { badRequest } from '../../common/errors';
import { IdempotencyKey } from '../../common/idempotency-key.decorator';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { AuthContext } from '../../core/auth.guard';
import { IdempotencyService } from '../../core/idempotency.service';
import { TasksService } from './task.service';
import {
  batchTaskSchema,
  completeTaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  reorderTasksSchema,
  uncompleteTaskSchema,
  updateTaskSchema,
  type BatchTaskInput,
  type CompleteTaskInput,
  type CreateTaskInput,
  type ListTasksQuery,
  type ReorderTasksInput,
  type UncompleteTaskInput,
  type UpdateTaskInput,
} from './task.dto';

const uuidSchema = z.uuid();

function parseIfMatch(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = z.coerce.number().int().min(1).safeParse(value);
  if (!parsed.success) {
    throw badRequest('If-Match 必须是正整数版本号');
  }
  return parsed.data;
}

@Controller('tasks')
export class TasksController {
  constructor(
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(listTasksQuerySchema)) query: ListTasksQuery,
  ) {
    return this.tasks.list(auth.userId, query);
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput,
  ) {
    return this.idempotency.run(auth.userId, idempotencyKey, () =>
      this.tasks.create(auth.userId, auth.deviceId, body),
    );
  }

  @Get(':taskId')
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('taskId', new ZodValidationPipe(uuidSchema)) taskId: string,
  ) {
    return this.tasks.get(auth.userId, taskId);
  }

  @Patch(':taskId')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('taskId', new ZodValidationPipe(uuidSchema)) taskId: string,
    @Headers('if-match') ifMatchHeader: string | undefined,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskInput,
  ) {
    return this.tasks.update(auth.userId, auth.deviceId, taskId, body, parseIfMatch(ifMatchHeader));
  }

  @Delete(':taskId')
  @HttpCode(204)
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('taskId', new ZodValidationPipe(uuidSchema)) taskId: string,
  ): Promise<void> {
    await this.tasks.remove(auth.userId, auth.deviceId, taskId);
  }

  @Post(':taskId/restore')
  @HttpCode(200)
  async restore(
    @CurrentAuth() auth: AuthContext,
    @Param('taskId', new ZodValidationPipe(uuidSchema)) taskId: string,
  ) {
    return this.tasks.restore(auth.userId, auth.deviceId, taskId);
  }

  @Post(':taskId/complete')
  @HttpCode(200)
  async complete(
    @CurrentAuth() auth: AuthContext,
    @Param('taskId', new ZodValidationPipe(uuidSchema)) taskId: string,
    @Body(new ZodValidationPipe(completeTaskSchema)) body: CompleteTaskInput,
  ) {
    return this.tasks.complete(auth.userId, auth.deviceId, taskId, body);
  }

  @Post(':taskId/uncomplete')
  @HttpCode(200)
  async uncomplete(
    @CurrentAuth() auth: AuthContext,
    @Param('taskId', new ZodValidationPipe(uuidSchema)) taskId: string,
    @Body(new ZodValidationPipe(uncompleteTaskSchema)) body: UncompleteTaskInput,
  ) {
    return this.tasks.uncomplete(auth.userId, auth.deviceId, taskId, body);
  }

  @Post('batch')
  @HttpCode(200)
  async batch(
    @CurrentAuth() auth: AuthContext,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(batchTaskSchema)) body: BatchTaskInput,
  ) {
    return this.idempotency.run(auth.userId, idempotencyKey, () =>
      this.tasks.batch(auth.userId, auth.deviceId, body),
    );
  }

  @Post('reorder')
  @HttpCode(204)
  async reorder(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(reorderTasksSchema)) body: ReorderTasksInput,
  ): Promise<void> {
    await this.tasks.reorder(auth.userId, auth.deviceId, body);
  }
}
