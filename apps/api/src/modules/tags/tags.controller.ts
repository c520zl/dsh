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
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { AuthContext } from '../../core/auth.guard';
import { TagsService } from './tags.service';
import {
  createTagSchema,
  updateTagSchema,
  type CreateTagInput,
  type UpdateTagInput,
} from './tag.dto';

const uuidSchema = z.uuid();

@Controller('tags')
export class TagsController {
  constructor(@Inject(TagsService) private readonly tags: TagsService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext) {
    return this.tags.list(auth.userId);
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createTagSchema)) body: CreateTagInput,
  ) {
    return this.tags.create(auth.userId, auth.deviceId, body);
  }

  @Patch(':tagId')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('tagId', new ZodValidationPipe(uuidSchema)) tagId: string,
    @Body(new ZodValidationPipe(updateTagSchema)) body: UpdateTagInput,
  ) {
    return this.tags.update(auth.userId, auth.deviceId, tagId, body);
  }

  @Delete(':tagId')
  @HttpCode(204)
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Param('tagId', new ZodValidationPipe(uuidSchema)) tagId: string,
  ): Promise<void> {
    await this.tags.delete(auth.userId, auth.deviceId, tagId);
  }
}
