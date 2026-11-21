import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public, TokenService } from '@nestjs/authentication';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { DIFFICULTIES, LEVELS, PACKS } from '../database/schema.js';
import { UsersRepository, toPublicUser } from '../users/users.repository.js';

export const settingsSchema = z.strictObject({
  level: z.enum(LEVELS).nullable().optional(),
  pack: z.enum(PACKS).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
});

const refreshSchema = z.strictObject({
  refreshToken: z.string().min(16).max(512),
});

// Anonymous accounts: the app calls POST /auth/device once, keeps the refresh token in the
// device's secure storage, and signs every request with the short-lived access token.
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly users: UsersRepository,
    private readonly tokens: TokenService,
  ) {}

  // RES-01: account creation is the cheapest way to get free lessons, so it has its own budget.
  @Post('device')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async registerDevice(
    @Body({ schema: settingsSchema }) settings: z.infer<typeof settingsSchema>,
  ) {
    const user = await this.users.create(settings);
    const tokens = await this.tokens.issue(user.id, { method: 'device' });
    return { user: toPublicUser(user), ...tokens };
  }

  // An unknown, expired or reused refresh token gets a 401; reuse revokes the whole family.
  @Post('token/refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(
    @Body({ schema: refreshSchema }) body: z.infer<typeof refreshSchema>,
  ) {
    return this.tokens.refresh(body.refreshToken);
  }

  @Post('sign-out')
  @HttpCode(204)
  async signOut(
    @Body({ schema: refreshSchema }) body: z.infer<typeof refreshSchema>,
  ): Promise<void> {
    await this.tokens.revoke(body.refreshToken);
  }
}
