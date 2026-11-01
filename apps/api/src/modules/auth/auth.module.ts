import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MAILER, MailerService } from './mailer.service';
import { OAUTH_VERIFIER, RemoteOAuthVerifier } from './oauth.service';
import { OtpStore } from './otp.store';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpStore,
    MailerService,
    RemoteOAuthVerifier,
    { provide: MAILER, useExisting: MailerService },
    { provide: OAUTH_VERIFIER, useExisting: RemoteOAuthVerifier },
  ],
  exports: [AuthService],
})
export class AuthModule {}
