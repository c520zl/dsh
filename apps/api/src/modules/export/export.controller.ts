import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentAuth } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import type { AuthContext } from '../../core/auth.guard';
import { ExportService } from './export.service';

const formatSchema = z.enum(['json', 'csv']);
const createExportSchema = z.object({ format: formatSchema }).strict();
const uuidSchema = z.uuid();

@Controller('export')
export class ExportController {
  constructor(@Inject(ExportService) private readonly exports: ExportService) {}

  @Post()
  @HttpCode(202)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createExportSchema)) body: { format: 'json' | 'csv' },
    @Req() request: FastifyRequest,
  ) {
    return this.exports.create(auth.userId, body.format, request.ip);
  }

  @Get(':exportId')
  async get(
    @CurrentAuth() auth: AuthContext,
    @Param('exportId', new ZodValidationPipe(uuidSchema)) exportId: string,
  ) {
    return this.exports.get(auth.userId, exportId);
  }

  /**
   * Local-storage MVP adapter for the download URL. A production deployment can
   * replace this with an object-storage signed URL without changing the job API.
   */
  @Get(':exportId/download')
  async download(
    @CurrentAuth() auth: AuthContext,
    @Param('exportId', new ZodValidationPipe(uuidSchema)) exportId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const download = await this.exports.readDownload(auth.userId, exportId);
    void reply
      .header('Content-Type', download.mime)
      .header(
        'Content-Disposition',
        `attachment; filename="${download.filename.replace(/"/g, '')}"`,
      )
      .send(download.body);
  }
}
