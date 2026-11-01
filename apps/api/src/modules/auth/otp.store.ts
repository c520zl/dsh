import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { rateLimited, unauthorized } from '../../common/errors';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { RedisService } from '../../core/redis.service';

interface OtpRecord {
  hash: string;
  attempts: number;
  expiresAt: number;
}

const KEY_PREFIX = 'todo:otp';

@Injectable()
export class OtpStore {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async issue(email: string, code: string): Promise<void> {
    const record: OtpRecord = {
      hash: this.hash(email, code),
      attempts: 0,
      expiresAt: Date.now() + this.config.otpTtlSeconds * 1000,
    };
    await this.redis.client.set(
      this.codeKey(email),
      JSON.stringify(record),
      'EX',
      this.config.otpTtlSeconds,
    );
  }

  async verify(email: string, code: string): Promise<void> {
    const record = await this.get(email);
    if (!record) {
      throw unauthorized('验证码无效或已过期');
    }
    if (record.attempts >= this.config.otpMaxAttempts) {
      await this.redis.client.del(this.codeKey(email));
      throw unauthorized('验证码尝试次数过多，请重新获取');
    }
    if (record.hash !== this.hash(email, code)) {
      record.attempts += 1;
      const ttl = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
      await this.redis.client.set(this.codeKey(email), JSON.stringify(record), 'EX', ttl);
      throw unauthorized('验证码无效或已过期');
    }
    await this.redis.client.del(this.codeKey(email));
  }

  async setCooldown(email: string): Promise<number | null> {
    const seconds = this.config.otpResendCooldownSeconds;
    if (seconds <= 0) {
      return null;
    }
    const acquired = await this.redis.client.set(
      `todo:otp:cooldown:${email.toLowerCase()}`,
      '1',
      'EX',
      seconds,
      'NX',
    );
    if (acquired) {
      return null;
    }
    const ttl = await this.redis.client.ttl(`todo:otp:cooldown:${email.toLowerCase()}`);
    return ttl > 0 ? ttl : seconds;
  }

  async clearCooldown(email: string): Promise<void> {
    await this.redis.client.del(`todo:otp:cooldown:${email.toLowerCase()}`);
  }

  async remove(email: string): Promise<void> {
    await this.redis.client.del(this.codeKey(email));
  }

  async hitHourly(scope: 'email' | 'ip', value: string): Promise<number> {
    const limit =
      scope === 'email' ? this.config.otpEmailHourlyLimit : this.config.otpIpHourlyLimit;
    const key = `todo:otp:hourly:${scope}:${value}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, 3600);
    }
    if (count > limit) {
      const ttl = await this.redis.client.ttl(key);
      throw rateLimited('请求过于频繁，请稍后重试', ttl > 0 ? ttl : 3600);
    }
    return count;
  }

  private async get(email: string): Promise<OtpRecord | null> {
    const value = await this.redis.client.get(this.codeKey(email));
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value) as OtpRecord;
    } catch {
      await this.redis.client.del(this.codeKey(email));
      return null;
    }
  }

  private codeKey(email: string): string {
    return `${KEY_PREFIX}:code:${email.toLowerCase()}`;
  }

  private hash(email: string, code: string): string {
    return createHash('sha256')
      .update(`${email.toLowerCase()}:${code}:${this.config.auditIpSalt}`)
      .digest('hex');
  }
}
