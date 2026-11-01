import { z } from 'zod';

export const deviceInfoSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    platform: z.enum(['ios', 'android', 'web']),
    appVersion: z.string().max(32).optional(),
    osVersion: z.string().max(32).optional(),
  })
  .strict();

export const otpRequestSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
  })
  .strict();

export const otpVerifySchema = z
  .object({
    email: z.email().transform((value) => value.toLowerCase()),
    code: z.string().regex(/^[0-9]{6}$/),
    device: deviceInfoSchema,
  })
  .strict();

export const oauthRequestSchema = z
  .object({
    identityToken: z.string().min(20),
    device: deviceInfoSchema,
  })
  .strict();

export const refreshRequestSchema = z
  .object({
    refreshToken: z.string().min(20),
  })
  .strict();

export type DeviceInfoInput = z.infer<typeof deviceInfoSchema>;
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type OAuthRequestInput = z.infer<typeof oauthRequestSchema>;
export type RefreshRequestInput = z.infer<typeof refreshRequestSchema>;

export interface AuthResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  deviceId: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    avatar: string | null;
    timezone: string;
    locale: 'zh-CN' | 'en';
    createdAt: string;
  };
}
