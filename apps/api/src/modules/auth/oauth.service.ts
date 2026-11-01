import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { unauthorized } from '../../common/errors';
import { APP_CONFIG, type AppConfig } from '../../config/config';

export const OAUTH_VERIFIER = Symbol('OAUTH_VERIFIER');

export type OAuthProvider = 'apple' | 'google';

export interface OAuthProfile {
  provider: OAuthProvider;
  subject: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
}

export interface OAuthVerifier {
  verify(provider: OAuthProvider, identityToken: string): Promise<OAuthProfile>;
}

@Injectable()
export class RemoteOAuthVerifier implements OAuthVerifier {
  private googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  private appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async verify(provider: OAuthProvider, identityToken: string): Promise<OAuthProfile> {
    if (provider === 'google') {
      if (!this.config.googleClientId) {
        throw unauthorized('Google 登录未配置');
      }
      return this.verifyGoogle(identityToken, this.config.googleClientId);
    }
    if (!this.config.appleClientId) {
      throw unauthorized('Apple 登录未配置');
    }
    return this.verifyApple(identityToken, this.config.appleClientId);
  }

  private async verifyGoogle(token: string, audience: string): Promise<OAuthProfile> {
    try {
      const { payload } = await jwtVerify(token, this.googleJwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience,
        algorithms: ['RS256'],
      });
      if (typeof payload.sub !== 'string') {
        throw new Error('missing sub');
      }
      return {
        provider: 'google',
        subject: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified: payload.email_verified === true || payload.email_verified === 'true',
        name: typeof payload.name === 'string' ? payload.name : undefined,
      };
    } catch {
      throw unauthorized('Google identityToken 无效');
    }
  }

  private async verifyApple(token: string, audience: string): Promise<OAuthProfile> {
    try {
      const { payload } = await jwtVerify(token, this.appleJwks, {
        issuer: 'https://appleid.apple.com',
        audience,
        algorithms: ['RS256'],
      });
      if (typeof payload.sub !== 'string') {
        throw new Error('missing sub');
      }
      return {
        provider: 'apple',
        subject: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified: payload.email_verified === true || payload.email_verified === 'true',
        name: undefined,
      };
    } catch {
      throw unauthorized('Apple identityToken 无效');
    }
  }
}
