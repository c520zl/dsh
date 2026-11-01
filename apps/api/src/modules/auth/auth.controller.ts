import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth, Public } from '../../common/decorators';
import type { AuthContext } from '../../core/auth.guard';
import { ZodValidationPipe } from '../../common/zod.pipe';
import {
  oauthRequestSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshRequestSchema,
  type OAuthRequestInput,
  type OtpRequestInput,
  type OtpVerifyInput,
  type RefreshRequestInput,
} from './auth.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(202)
  async requestOtp(
    @Body(new ZodValidationPipe(otpRequestSchema)) body: OtpRequestInput,
    @Req() request: FastifyRequest,
  ): Promise<{ message: string }> {
    return this.auth.requestOtp(body, request.ip);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerifyInput,
    @Req() request: FastifyRequest,
  ) {
    return this.auth.verifyOtp(body, request.ip);
  }

  @Public()
  @Post('oauth/apple')
  @HttpCode(200)
  async loginWithApple(
    @Body(new ZodValidationPipe(oauthRequestSchema)) body: OAuthRequestInput,
    @Req() request: FastifyRequest,
  ) {
    return this.auth.loginWithOAuth('apple', body, request.ip);
  }

  @Public()
  @Post('oauth/google')
  @HttpCode(200)
  async loginWithGoogle(
    @Body(new ZodValidationPipe(oauthRequestSchema)) body: OAuthRequestInput,
    @Req() request: FastifyRequest,
  ) {
    return this.auth.loginWithOAuth('google', body, request.ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequestInput) {
    return this.auth.refresh(body);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<void> {
    await this.auth.logout(auth.userId, auth.deviceId, request.ip);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<void> {
    await this.auth.logoutAll(auth.userId, request.ip);
  }
}
