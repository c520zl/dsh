import type { users } from '../db/schema';

export type UserRow = typeof users.$inferSelect;

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  avatar: string | null;
  timezone: string;
  locale: 'zh-CN' | 'en';
  createdAt: string;
}

export function toUserDto(user: UserRow): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatar: user.avatar,
    timezone: user.timezone,
    locale: user.locale as 'zh-CN' | 'en',
    createdAt: user.createdAt.toISOString(),
  };
}
