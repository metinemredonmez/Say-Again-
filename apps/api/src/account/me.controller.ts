import { Body, Controller, Delete, Get, HttpCode, Patch } from '@nestjs/common';
import { CurrentUser, TokenService } from '@nestjs/authentication';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import { settingsSchema } from '../auth/auth.controller.js';
import { QuotaService } from '../quota/quota.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import {
  UsersRepository,
  toPublicUser,
  type AppUser,
} from '../users/users.repository.js';

// Account screen: settings, quota, subscription, and deleting the account with all its data from
// inside the app (App Store and Google Play requirement; KVKK).
@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersRepository,
    private readonly quota: QuotaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly tokens: TokenService,
  ) {}

  @Get()
  async me(@CurrentUser() user: AppUser) {
    const [quota, subscription] = await Promise.all([
      this.quota.status(user.id),
      this.subscriptions.current(user.id),
    ]);
    return {
      user: toPublicUser(user),
      // The app passes this as Apple's appAccountToken and Google's obfuscatedAccountId.
      storeAccountToken: user.id,
      quota,
      subscription,
    };
  }

  @Patch()
  async update(
    @CurrentUser() user: AppUser,
    @Body({ schema: settingsSchema }) body: z.infer<typeof settingsSchema>,
  ) {
    return { user: toPublicUser(await this.users.update(user.id, body)) };
  }

  // Deletes lessons, transcripts, corrections, phrases, reviews, quota and subscription records,
  // and revokes every refresh token. A store subscription itself is cancelled in the store.
  @Delete()
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async remove(@CurrentUser() user: AppUser): Promise<void> {
    await this.tokens.revokeAll(user.id);
    await this.users.delete(user.id);
  }
}
