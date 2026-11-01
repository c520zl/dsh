import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config';

export const MAILER = Symbol('MAILER');

export interface Mailer {
  sendOtp(email: string, code: string): Promise<void>;
}

@Injectable()
export class MailerService implements Mailer {
  private readonly logger = new Logger(MailerService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.nodeEnv === 'production' && config.mailDriver === 'log') {
      throw new Error(
        'MAIL_DRIVER=log is not allowed in production; configure MAIL_DRIVER=resend.',
      );
    }
  }

  async sendOtp(email: string, code: string): Promise<void> {
    if (this.config.mailDriver === 'resend') {
      await this.sendWithResend(email, code);
      return;
    }
    this.logger.warn(`[dev mail] OTP for ${maskEmail(email)}: ${code}`);
  }

  private async sendWithResend(email: string, code: string): Promise<void> {
    if (!this.config.resendApiKey) {
      throw new Error('RESEND_API_KEY is required when MAIL_DRIVER=resend');
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.mailFrom,
        to: [email],
        subject: 'Todo App 登录验证码',
        text: `你的 Todo App 验证码是 ${code}，${Math.round(this.config.otpTtlSeconds / 60)} 分钟内有效。请勿将验证码转发给他人。`,
      }),
    });
    if (!response.ok) {
      throw new Error(`Resend API error: HTTP ${response.status}`);
    }
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  const prefix = (local ?? '').slice(0, 2);
  return `${prefix}***@${domain ?? 'unknown'}`;
}
