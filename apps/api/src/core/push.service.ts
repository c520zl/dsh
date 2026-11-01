import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';

export interface PushPayload {
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushResult {
  ok: boolean;
  invalidToken?: boolean;
  error?: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async send(token: string, provider: string | null, payload: PushPayload): Promise<PushResult> {
    if (!this.config.pushEnabled) {
      this.logger.log(
        `[push disabled] to=${token.slice(0, 6)}… provider=${provider ?? 'unknown'} title=${payload.title}`,
      );
      return { ok: true };
    }
    if (this.config.pushDriver === 'expo' || provider === 'expo') {
      return this.sendExpo(token, payload);
    }
    this.logger.warn(`Push provider ${provider ?? 'unknown'} is not implemented`);
    return { ok: false, error: 'unsupported_provider' };
  }

  private async sendExpo(token: string, payload: PushPayload): Promise<PushResult> {
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: token,
          title: payload.title,
          body: payload.body,
          data: payload.data,
          sound: 'default',
        }),
      });
      if (!response.ok) {
        return { ok: false, error: `expo_http_${response.status}` };
      }
      const body = (await response.json()) as {
        data?: { status?: string; details?: { error?: string } };
      };
      if (body.data?.status === 'error') {
        return {
          ok: false,
          invalidToken: body.data.details?.error === 'DeviceNotRegistered',
          error: body.data.details?.error ?? 'expo_error',
        };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'push_failed' };
    }
  }
}
