import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth } from '../../common/decorators';
import { IdempotencyKey } from '../../common/idempotency-key.decorator';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { AuthContext } from '../../core/auth.guard';
import { IdempotencyService } from '../../core/idempotency.service';
import { ListsService } from './lists.service';
import {
  createListSchema,
  deleteListSchema,
  updateListSchema,
  type CreateListInput,
  type DeleteListInput,
  type UpdateListInput,
} from './list.dto';

const includeArchivedSchema = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');
const idSchema = z.uuid();

@Controller('lists')
export class ListsController {
  constructor(
    @Inject(ListsService) private readonly lists: ListsService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query('includeArchived', new ZodValidationPipe(includeArchivedSchema))
    includeArchived: boolean,
  ) {
    return this.lists.list(auth.userId, includeArchived);
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createListSchema)) body: CreateListInput,
  ) {
    return this.idempotency.run(auth.userId, idempotencyKey, () =>
      this.lists.create(auth.userId, auth.deviceId, body),
    );
  }

  @Patch(':listId')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('listId', new ZodValidationPipe(idSchema)) listId: string,
    @Body(new ZodValidationPipe(updateListSchema)) body: UpdateListInput,
  ) {
    return this.lists.update(auth.userId, auth.deviceId, listId, body);
  }

  @Delete(':listId')
  @HttpCode(204)
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param('listId', new ZodValidationPipe(idSchema)) listId: string,
    @Body(new ZodValidationPipe(deleteListSchema)) body: DeleteListInput,
  ): Promise<void> {
    await this.lists.delete(auth.userId, auth.deviceId, listId, body);
  }
}
