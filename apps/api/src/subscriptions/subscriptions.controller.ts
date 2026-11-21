import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { CurrentUser, Public } from '@nestjs/authentication';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { AppUser } from '../users/users.repository.js';
import { SubscriptionsService } from './subscriptions.service.js';

// Purchase: the transaction id. Restore: the transaction's JWS signed by Apple on the device
// (StoreKit jwsRepresentation), which proves the device's Apple account owns it.
const appleSchema = z.union([
  z.strictObject({ transactionId: z.string().regex(/^\d{1,32}$/) }),
  z.strictObject({ signedTransaction: z.string().min(20).max(20_000) }),
]);
const googleSchema = z.strictObject({
  purchaseToken: z.string().min(10).max(1024),
  restore: z.boolean().default(false),
});
const appleNotificationSchema = z.object({
  // Apple may add fields; only signedPayload is read.
  signedPayload: z.string().min(10).max(100_000),
});

@Controller('subscriptions')
@Throttle({ default: { limit: 20, ttl: 3_600_000 } })
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  // Purchase and "restore purchases" both send the store's id; the server asks the store.
  @Post('apple')
  @HttpCode(200)
  apple(
    @CurrentUser() user: AppUser,
    @Body({ schema: appleSchema }) body: z.infer<typeof appleSchema>,
  ) {
    return this.subscriptions.verifyApple(user, body);
  }

  @Post('google')
  @HttpCode(200)
  google(
    @CurrentUser() user: AppUser,
    @Body({ schema: googleSchema }) body: z.infer<typeof googleSchema>,
  ) {
    return this.subscriptions.verifyGoogle(
      user,
      body.purchaseToken,
      body.restore,
    );
  }
}

// Store-to-server notifications. They carry no user session; each one is authenticated by its
// own signature (Apple JWS chain) or token (Google OIDC), and anything else gets a 401.
// EXT-04: a notification only triggers a fresh read from the store, so a replayed one changes
// nothing. RES-01: a high per-address budget, far above what a store sends; both stores retry.
@Public()
@Throttle({ default: { limit: 1200, ttl: 60_000 } })
@Controller('webhooks')
export class StoreWebhooksController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post('app-store')
  @HttpCode(200)
  async appStore(
    @Body({ schema: appleNotificationSchema })
    body: z.infer<typeof appleNotificationSchema>,
  ) {
    if (!(await this.subscriptions.appleNotification(body.signedPayload))) {
      throw new UnauthorizedException();
    }
    return { ok: true };
  }

  @Post('google-play')
  @HttpCode(204)
  async googlePlay(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    if (!(await this.subscriptions.googleNotification(authorization, body))) {
      throw new UnauthorizedException();
    }
  }
}
