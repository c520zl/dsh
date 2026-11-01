import { Body, Controller, Delete, Get, HttpCode, Inject, Patch, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { AuthContext } from '../../core/auth.guard';
import { updateMeSchema, type UpdateMeInput } from './me.dto';
import { MeService } from './me.service';

@Controller('me')
export class MeController {
  constructor(@Inject(MeService) private readonly me: MeService) {}

  @Get()
  async getMe(@CurrentAuth() auth: AuthContext) {
    return this.me.getMe(auth.userId);
  }

  @Patch()
  async updateMe(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateMeSchema)) body: UpdateMeInput,
  ) {
    return this.me.updateMe(auth.userId, body);
  }

  @Delete()
  @HttpCode(202)
  async deleteMe(@CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest) {
    return this.me.deleteMe(auth.userId, request.ip);
  }
}
