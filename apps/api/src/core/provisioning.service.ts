import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { newId } from '../domain/ids';
import { newListSortRank } from '../domain/sort-rank';
import { authIdentities, lists, userSettings, users } from '../db/schema';
import { DatabaseService } from './database.service';

export interface CreateUserInput {
  email: string;
  displayName: string;
  timezone?: string;
  locale?: 'zh-CN' | 'en';
  avatar?: string | null;
  provider?: 'email' | 'apple' | 'google';
  providerUserId?: string;
}

@Injectable()
export class ProvisioningService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /**
   * First login creates the user, default inbox, settings and email identity in
   * one transaction (FR-1). The inbox is not logged to sync because the first
   * device discovers it through the initial REST snapshot.
   */
  async createUser(input: CreateUserInput): Promise<{ userId: string; inboxId: string }> {
    const locale = input.locale ?? 'zh-CN';
    const timezone = input.timezone ?? 'UTC';
    const userId = newId();
    const inboxId = newId();

    await this.database.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        avatar: input.avatar ?? null,
        timezone,
        locale,
      });
      await tx.insert(lists).values({
        id: inboxId,
        userId,
        name: locale === 'en' ? 'Inbox' : '收件箱',
        color: 'coral',
        icon: 'inbox',
        sortRank: newListSortRank(0),
        isDefault: true,
      });
      await tx.insert(userSettings).values({
        userId,
        defaultListId: inboxId,
        defaultReminderTime: '09:00',
      });
      await tx.insert(authIdentities).values({
        id: newId(),
        userId,
        provider: input.provider ?? 'email',
        providerUserId: input.providerUserId ?? input.email.toLowerCase(),
      });
    });

    return { userId, inboxId };
  }

  async getInbox(listId: string): Promise<{ id: string; name: string } | null> {
    const [row] = await this.database.db
      .select({ id: lists.id, name: lists.name })
      .from(lists)
      .where(eq(lists.id, listId))
      .limit(1);
    return row ?? null;
  }
}
