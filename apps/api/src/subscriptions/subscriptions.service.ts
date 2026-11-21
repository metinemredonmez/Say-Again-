import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, ne } from 'drizzle-orm';
import { ApiError } from '../common/api-error.js';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.js';
import { STORES, subscriptions, users } from '../database/schema.js';
import type { AppUser } from '../users/users.repository.js';
import {
  AppleStore,
  GooglePlayStore,
  StoreRejectedError,
  StoreUnavailableError,
  StoreUnverifiedError,
  type StoreSubscription,
} from './stores.js';

// Links store purchases to accounts. The app passes the user id as Apple's appAccountToken and
// Google's obfuscatedAccountId when it starts a purchase. One purchase belongs to one account
// (unique store + store_ref). It moves to another account only on proof from the store:
//  - the store-verified account token names the caller (a resubscription from a new account), or
//  - a restore: Apple's transaction signed on the device (only the buyer's device has it), or
//    Google's purchase token (a long secret only the buyer's device has).
// Anonymous accounts get lost on reinstall, so restore must be able to move a purchase.

type Store = (typeof STORES)[number];

export function subscriptionView(
  row: typeof subscriptions.$inferSelect | null,
) {
  return row
    ? {
        store: row.store,
        productId: row.productId,
        status: row.status,
        currentPeriodEnd: row.currentPeriodEnd,
        sandbox: row.sandbox,
      }
    : null;
}

const isUuid = (value: string | null): value is string =>
  !!value && /^[0-9a-f-]{36}$/i.test(value);

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly apple: AppleStore | null;
  private readonly google: GooglePlayStore | null;
  private readonly products: Set<string>;

  constructor(
    @InjectDrizzle() private readonly db: Database,
    config: ConfigService<Env, true>,
  ) {
    const keys = [
      'APPLE_BUNDLE_ID',
      'APPLE_APP_APPLE_ID',
      'APPLE_ISSUER_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY',
      'APPLE_ENVIRONMENT',
      'APPLE_ROOT_CERTS_DIR',
      'GOOGLE_PACKAGE_NAME',
      'GOOGLE_SERVICE_ACCOUNT_JSON',
      'GOOGLE_PUBSUB_AUDIENCE',
      'GOOGLE_PUBSUB_SERVICE_ACCOUNT',
    ] as const;
    const env = Object.fromEntries(
      keys.map((key) => [key, config.get(key, { infer: true })]),
    ) as unknown as Env;
    this.apple = AppleStore.configured(env) ? new AppleStore(env) : null;
    this.google = GooglePlayStore.configured(env)
      ? new GooglePlayStore(env)
      : null;
    this.products = new Set(
      config.get('SUBSCRIPTION_PRODUCT_IDS', { infer: true }),
    );
  }

  /** The user's most relevant subscription: one that grants access, else the latest to end. */
  async current(userId: string) {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));
    const grants = (r: (typeof rows)[number]) =>
      r.status === 'active' || r.status === 'grace' ? 1 : 0;
    rows.sort(
      (a, b) =>
        grants(b) - grants(a) ||
        (b.currentPeriodEnd?.getTime() ?? 0) -
          (a.currentPeriodEnd?.getTime() ?? 0),
    );
    return subscriptionView(rows[0] ?? null);
  }

  /**
   * App Store purchase (StoreKit 2 transaction id) or restore (the transaction's signed JWS from
   * the device, which also lets the purchase move to this account).
   */
  async verifyApple(
    user: AppUser,
    input: { transactionId: string } | { signedTransaction: string },
  ) {
    const apple = this.require(this.apple, 'app_store');
    const restore = 'signedTransaction' in input;
    const found = await this.ask(() =>
      restore
        ? apple.verifySignedTransaction(input.signedTransaction)
        : apple.lookup(input.transactionId),
    );
    const result = await this.link(user, 'app_store', found, restore);
    if (restore && found.accountToken !== user.id) {
      // Renewals of this purchase now name the new account, so notifications stay with it.
      await this.ask(() =>
        apple.setAccountToken(found.storeRef, user.id, found.sandbox),
      );
    }
    return result;
  }

  /** Google Play purchase or restore (the purchase token, a secret of the buyer's device). */
  async verifyGoogle(user: AppUser, purchaseToken: string, restore: boolean) {
    const google = this.require(this.google, 'play_store');
    const found = await this.ask(() => google.lookup(purchaseToken));
    const result = await this.link(user, 'play_store', found, restore);
    if (
      found.needsAcknowledgement &&
      (found.status === 'active' || found.status === 'grace')
    ) {
      await this.ask(() => google.acknowledge(found.productId, found.storeRef));
    }
    return result;
  }

  /**
   * App Store Server Notifications V2. Returns false when the payload is not from Apple; a
   * permanent problem after verification is logged and acknowledged so Apple stops resending.
   */
  async appleNotification(signedPayload: string): Promise<boolean> {
    if (!this.apple) {
      return false;
    }
    try {
      const found = await this.apple.fromNotification(signedPayload);
      if (found) {
        await this.applyStoreUpdate('app_store', found);
      }
      return true;
    } catch (error) {
      if (error instanceof StoreUnverifiedError) {
        this.logger.warn(`App Store notification refused: ${error.message}`);
        return false;
      }
      if (error instanceof StoreRejectedError) {
        this.logger.warn(
          `App Store notification not applied: ${error.message}`,
        );
        return true;
      }
      throw error; // unavailable: answer 5xx so Apple retries
    }
  }

  /** Google Play real-time developer notification (Pub/Sub push). */
  async googleNotification(
    authorization: string | undefined,
    body: unknown,
  ): Promise<boolean> {
    if (!this.google || !(await this.google.verifyPush(authorization))) {
      return false;
    }
    const data = (body as { message?: { data?: string } })?.message?.data;
    if (!data) {
      return true;
    }
    let notification: {
      packageName?: string;
      subscriptionNotification?: { purchaseToken?: string };
    };
    try {
      notification = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    } catch {
      return true; // malformed but authenticated: acknowledge so it is not redelivered forever
    }
    const token = notification.subscriptionNotification?.purchaseToken;
    if (notification.packageName !== this.google.packageName || !token) {
      return true; // test notification, one-time product or another app
    }
    try {
      await this.applyStoreUpdate(
        'play_store',
        await this.google.lookup(token),
      );
    } catch (error) {
      if (error instanceof StoreRejectedError) {
        this.logger.warn(
          `Google Play notification not applied: ${error.message}`,
        );
        return true;
      }
      throw error;
    }
    return true;
  }

  // Helpers

  private async link(
    user: AppUser,
    store: Store,
    found: StoreSubscription,
    restore: boolean,
  ) {
    if (!this.products.has(found.productId)) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'unknown_product',
        'This product is not a subscription of this app',
      );
    }
    if (found.accountToken !== user.id && !restore) {
      this.logger.warn(
        `Store purchase for another account refused (store ${store})`,
      );
      throw new ApiError(
        HttpStatus.CONFLICT,
        'purchase_other_account',
        'This purchase was made from another account; use restore purchases',
      );
    }
    const row = await this.upsert(user.id, store, found);
    return { subscription: subscriptionView(row) };
  }

  /** A store notification: update the purchase for the account it belongs to now. */
  private async applyStoreUpdate(store: Store, found: StoreSubscription) {
    if (!this.products.has(found.productId)) {
      return;
    }
    const [existing] = await this.db
      .select({ userId: subscriptions.userId })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.store, store),
          eq(subscriptions.storeRef, found.storeRef),
        ),
      );
    // Apple's account token follows the latest purchase and our restores (setAccountToken), so
    // it decides. Google's stays as it was at purchase, so the linked row's owner decides.
    let ownerId = store === 'play_store' ? (existing?.userId ?? null) : null;
    if (!ownerId && isUuid(found.accountToken)) {
      const [user] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, found.accountToken));
      ownerId = user?.id ?? null;
    }
    ownerId ??= existing?.userId ?? null;
    if (ownerId) {
      await this.upsert(ownerId, store, found);
    }
    // Otherwise it is not linked yet; the app's verify call will link it.
  }

  private async upsert(userId: string, store: Store, found: StoreSubscription) {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [previous] = await tx
        .select({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.store, store),
            eq(subscriptions.storeRef, found.storeRef),
          ),
        )
        .for('update');
      if (previous && previous.userId !== userId) {
        this.logger.log(
          `Store purchase moved to another account (store ${store})`,
        );
      }
      const state = {
        userId,
        productId: found.productId,
        status: found.status,
        currentPeriodEnd: found.currentPeriodEnd,
        sandbox: found.sandbox,
        updatedAt: now,
      };
      const [row] = await tx
        .insert(subscriptions)
        .values({ ...state, store, storeRef: found.storeRef })
        .onConflictDoUpdate({
          target: [subscriptions.store, subscriptions.storeRef],
          set: state,
        })
        .returning();
      if (found.replacesStoreRef) {
        // An upgrade or resubscription replaces the earlier purchase of the same account.
        await tx
          .update(subscriptions)
          .set({ status: 'expired', updatedAt: now })
          .where(
            and(
              eq(subscriptions.store, store),
              eq(subscriptions.storeRef, found.replacesStoreRef),
              eq(subscriptions.userId, userId),
              ne(subscriptions.storeRef, found.storeRef),
            ),
          );
      }
      return row;
    });
  }

  private require<T>(store: T | null, name: Store): T {
    if (!store) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'store_not_configured',
        `${name} verification is not configured`,
      );
    }
    return store;
  }

  private async ask<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (
        error instanceof StoreRejectedError ||
        error instanceof StoreUnverifiedError
      ) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'purchase_not_valid',
          'The store did not confirm this purchase',
        );
      }
      if (error instanceof StoreUnavailableError) {
        throw new ApiError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'store_unavailable',
          'The store is not reachable; try again',
        );
      }
      throw error;
    }
  }
}
