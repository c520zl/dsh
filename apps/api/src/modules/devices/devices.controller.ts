import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentAuth } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { AuthContext } from '../../core/auth.guard';
import { DevicesService } from './devices.service';
import { updateDeviceSchema, type UpdateDeviceInput } from './device.dto';

const uuidSchema = z.uuid();

@Controller('devices')
export class DevicesController {
  constructor(@Inject(DevicesService) private readonly devices: DevicesService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext) {
    return this.devices.list(auth.userId);
  }

  @Patch(':deviceId')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('deviceId', new ZodValidationPipe(uuidSchema)) deviceId: string,
    @Body(new ZodValidationPipe(updateDeviceSchema)) body: UpdateDeviceInput,
    @Req() request: FastifyRequest,
  ) {
    return this.devices.update(auth.userId, deviceId, body, request.ip);
  }

  @Delete(':deviceId')
  @HttpCode(204)
  async revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('deviceId', new ZodValidationPipe(uuidSchema)) deviceId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.devices.revoke(auth.userId, deviceId, request.ip);
  }
}
