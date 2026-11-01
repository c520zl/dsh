import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, lt } from 'drizzle-orm';
import { unauthorized } from '../common/errors';
import { PUBLIC_ROUTE, type RequestWithAuth } from '../common/decorators';
import { DatabaseService } from './database.service';
import { devices, users } from '../db/schema';
import { TokenService } from './token.service';

export interface AuthContext {
  userId: string;
  deviceId: string;
  authVersion: number;
  deviceAuthVersion: number;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = extractAccessToken(request);
    if (!token) {
      throw unauthorized('缺少访问令牌');
    }
    const claims = await this.tokens.verifyAccessToken(token);
    if (claims.authVersion === undefined || claims.deviceAuthVersion === undefined) {
      throw unauthorized('访问令牌无效');
    }

    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, claims.uid))
      .limit(1);
    if (!user || user.deletedAt || user.authVersion !== claims.authVersion) {
      throw unauthorized('访问令牌已失效');
    }

    const [device] = await this.database.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, claims.did), eq(devices.userId, user.id)))
      .limit(1);
    if (!device || device.revokedAt || device.authVersion !== claims.deviceAuthVersion) {
      throw unauthorized('设备已被移除或令牌已失效');
    }

    request.auth = {
      userId: user.id,
      deviceId: device.id,
      authVersion: user.authVersion,
      deviceAuthVersion: device.authVersion,
    };

    // Keep last_seen_at fresh without writing on every single request.
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
    if (device.lastSeenAt < fiveMinutesAgo) {
      await this.database.db
        .update(devices)
        .set({ lastSeenAt: new Date() })
        .where(and(eq(devices.id, device.id), lt(devices.lastSeenAt, fiveMinutesAgo)));
    }

    return true;
  }
}

function extractAccessToken(request: RequestWithAuth): string | null {
  const header = request.headers.authorization;
  if (header) {
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && value) {
      return value;
    }
  }
  const cookieHeader = request.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === 'todo_session') {
        return decodeURIComponent(rest.join('=')) || null;
      }
    }
  }
  return null;
}
