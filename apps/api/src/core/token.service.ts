import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
import { randomBytes, createHash } from 'node:crypto';
import { unauthorized } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { newId } from '../domain/ids';

export interface AccessTokenClaims {
  uid: string;
  did: string;
  authVersion: number;
  deviceAuthVersion: number;
}

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);
  private privateKey!: Awaited<ReturnType<typeof importPKCS8>>;
  private publicKey!: Awaited<ReturnType<typeof importSPKI>>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    this.privateKey = await importPKCS8(this.config.jwtPrivateKeyPem, 'EdDSA');
    this.publicKey = await importSPKI(this.config.jwtPublicKeyPem, 'EdDSA');
    this.logger.log(
      `Access tokens: EdDSA, ttl=${this.config.accessTokenTtlSeconds}s, issuer=${this.config.jwtIssuer}`,
    );
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<{ token: string; expiresIn: number }> {
    const token = await new SignJWT({
      uid: claims.uid,
      did: claims.did,
      authVersion: claims.authVersion,
      deviceAuthVersion: claims.deviceAuthVersion,
    })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(this.config.jwtIssuer)
      .setAudience(this.config.jwtAudience)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTokenTtlSeconds}s`)
      .setJti(newId())
      .sign(this.privateKey);
    return { token, expiresIn: this.config.accessTokenTtlSeconds };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        algorithms: ['EdDSA'],
      });
      if (
        typeof payload.uid !== 'string' ||
        typeof payload.did !== 'string' ||
        typeof payload.authVersion !== 'number' ||
        typeof payload.deviceAuthVersion !== 'number'
      ) {
        throw new Error('Malformed token claims');
      }
      return {
        uid: payload.uid,
        did: payload.did,
        authVersion: payload.authVersion,
        deviceAuthVersion: payload.deviceAuthVersion,
      };
    } catch {
      throw unauthorized('访问令牌无效或已过期');
    }
  }

  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
