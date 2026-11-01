import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { z } from 'zod';
import { badRequest } from './errors';

const uuidSchema = z.uuid();

/**
 * Reads and validates the optional Idempotency-Key header. Nest's built-in
 * @Headers() does not accept a pipe, so this decorator validates in place.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const raw = request.headers['idempotency-key'];
    if (raw === undefined) {
      return undefined;
    }
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = uuidSchema.safeParse(value);
    if (!parsed.success) {
      throw badRequest('Idempotency-Key 必须是 UUID');
    }
    return parsed.data;
  },
);
