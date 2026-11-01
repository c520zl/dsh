import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { badRequest } from './errors';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw badRequest('参数校验失败', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
