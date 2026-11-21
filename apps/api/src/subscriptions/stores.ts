import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  APIError,
  APIException,
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  Status,
  VerificationException,
  VerificationStatus,
  type JWSTransactionDecodedPayload,
} from '@apple/app-store-server-library';
import {
  androidpublisher,
  auth,
  type androidpublisher_v3,
} from '@googleapis/androidpublisher';
import { OAuth2Client } from 'google-auth-library';
import type { Env } from '../config/env.js';
import { SUBSCRIPTION_STATUSES } from '../database/schema.js';

// Direct verification with the stores (no third party). The store is the only source of truth:
// product, expiry and owner are never taken from the client (BUS, AZ-01). The keys live only in
// apps/api/.env (KEY).

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface StoreSubscription {
  storeRef: string;
  productId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  /** The account id the app attached at purchase (Apple appAccountToken, Google obfuscated id). */
  accountToken: string | null;
  sandbox: boolean;
  /** Google: the token this purchase replaced (upgrade, resubscribe). */
  replacesStoreRef?: string | null;
  /** Google: the purchase still has to be acknowledged. */
  needsAcknowledgement?: boolean;
}

/** The store said no, for a reason a retry will not change. */
export class StoreRejectedError extends Error {}
/** The store could not be reached or asked us to retry. */
export class StoreUnavailableError extends Error {}
/** A signed payload did not verify: it did not come from the store. */
export class StoreUnverifiedError extends Error {}

// Apple

type AppleTarget = {
  environment: Environment;
  client: AppStoreServerAPIClient;
  verifier: SignedDataVerifier;
};

export class AppleStore {
  private readonly targets: AppleTarget[];

  constructor(env: Env) {
    const certs = readdirSync(env.APPLE_ROOT_CERTS_DIR!)
      .filter((f) => f.endsWith('.cer'))
      .map((f) => readFileSync(join(env.APPLE_ROOT_CERTS_DIR!, f)));
    if (certs.length === 0) {
      throw new Error(
        'APPLE_ROOT_CERTS_DIR has no .cer files (download Apple root certificates)',
      );
    }
    const key = env.APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n');
    const make = (environment: Environment): AppleTarget => ({
      environment,
      client: new AppStoreServerAPIClient(
        key,
        env.APPLE_KEY_ID!,
        env.APPLE_ISSUER_ID!,
        env.APPLE_BUNDLE_ID!,
        environment,
      ),
      verifier: new SignedDataVerifier(
        certs,
        true,
        environment,
        env.APPLE_BUNDLE_ID!,
        env.APPLE_APP_APPLE_ID,
      ),
    });
    // Production apps also see sandbox purchases (App Review buys in the sandbox), so production
    // checks production first and the sandbox second, as Apple recommends.
    this.targets =
      env.APPLE_ENVIRONMENT === 'Production'
        ? [make(Environment.PRODUCTION), make(Environment.SANDBOX)]
        : [make(Environment.SANDBOX)];
  }

  static configured(env: Env): boolean {
    return Boolean(
      env.APPLE_BUNDLE_ID &&
      env.APPLE_ISSUER_ID &&
      env.APPLE_KEY_ID &&
      env.APPLE_PRIVATE_KEY &&
      env.APPLE_ROOT_CERTS_DIR &&
      (env.APPLE_ENVIRONMENT === 'Sandbox' || env.APPLE_APP_APPLE_ID),
    );
  }

  /** Current state of the subscription a transaction belongs to. */
  async lookup(transactionId: string): Promise<StoreSubscription> {
    for (const [index, target] of this.targets.entries()) {
      let tx: JWSTransactionDecodedPayload;
      try {
        const { signedTransactionInfo } =
          await target.client.getTransactionInfo(transactionId);
        if (!signedTransactionInfo) {
          throw new StoreRejectedError('No transaction info');
        }
        tx = await target.verifier.verifyAndDecodeTransaction(
          signedTransactionInfo,
        );
      } catch (error) {
        const notFound =
          error instanceof APIException &&
          error.apiError === APIError.TRANSACTION_ID_NOT_FOUND;
        if (notFound && index < this.targets.length - 1) {
          continue;
        }
        throw this.wrap(error);
      }
      return this.current(target, tx);
    }
    throw new StoreRejectedError('Transaction not found');
  }

  /**
   * A transaction signed by Apple on the device (StoreKit's jwsRepresentation). Only the device
   * signed in to the buyer's Apple account has it, so it proves the right to restore.
   */
  async verifySignedTransaction(jws: string): Promise<StoreSubscription> {
    const { target, value: tx } = await this.verify((t) =>
      t.verifier.verifyAndDecodeTransaction(jws),
    );
    return this.current(target, tx);
  }

  /**
   * App Store Server Notification V2: verify it, then read the current state from Apple.
   * Throws StoreUnverifiedError when the payload did not come from Apple.
   */
  async fromNotification(
    signedPayload: string,
  ): Promise<StoreSubscription | null> {
    const { target, value: tx } = await this.verify(async (t) => {
      const payload =
        await t.verifier.verifyAndDecodeNotification(signedPayload);
      const signedTx = payload.data?.signedTransactionInfo;
      // TEST and summary notifications carry no transaction.
      return signedTx ? t.verifier.verifyAndDecodeTransaction(signedTx) : null;
    });
    return tx ? this.current(target, tx) : null;
  }

  /** Points future transactions of a purchase at another account (after a restore). */
  async setAccountToken(
    storeRef: string,
    accountToken: string,
    sandbox: boolean,
  ): Promise<void> {
    const target =
      this.targets.find(
        (t) => (t.environment === Environment.SANDBOX) === sandbox,
      ) ?? this.targets[0];
    try {
      await target.client.setAppAccountToken(storeRef, {
        appAccountToken: accountToken,
      });
    } catch (error) {
      throw this.wrap(error);
    }
  }

  /** Verifies signed data with production first, then the sandbox. */
  private async verify<T>(
    decode: (target: AppleTarget) => Promise<T>,
  ): Promise<{ target: AppleTarget; value: T }> {
    for (const [index, target] of this.targets.entries()) {
      try {
        return { target, value: await decode(target) };
      } catch (error) {
        if (error instanceof VerificationException) {
          if (
            error.status === VerificationStatus.INVALID_ENVIRONMENT &&
            index < this.targets.length - 1
          ) {
            continue;
          }
          if (
            error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
          ) {
            throw new StoreUnavailableError(
              'Apple verification could not complete',
            );
          }
          throw new StoreUnverifiedError(
            `Apple verification failed (${error.status})`,
          );
        }
        throw this.wrap(error);
      }
    }
    throw new StoreUnverifiedError('Apple verification failed');
  }

  private async current(
    target: AppleTarget,
    tx: JWSTransactionDecodedPayload,
  ): Promise<StoreSubscription> {
    if (!tx.originalTransactionId || !tx.productId) {
      throw new StoreRejectedError('Transaction without ids');
    }
    try {
      // The statuses endpoint gives the latest state, whatever order notifications arrive in.
      const statuses = await target.client.getAllSubscriptionStatuses(
        tx.originalTransactionId,
      );
      const last = statuses.data
        ?.flatMap((group) => group.lastTransactions ?? [])
        .find((t) => t.originalTransactionId === tx.originalTransactionId);
      let latest = tx;
      let status: SubscriptionStatus = 'expired';
      if (last?.signedTransactionInfo) {
        latest = await target.verifier.verifyAndDecodeTransaction(
          last.signedTransactionInfo,
        );
        status =
          last.status === Status.ACTIVE
            ? 'active'
            : last.status === Status.BILLING_GRACE_PERIOD
              ? 'grace'
              : last.status === Status.REVOKED
                ? 'revoked'
                : 'expired';
      }
      if (latest.revocationDate) {
        status = 'refunded';
      }
      let currentPeriodEnd = latest.expiresDate
        ? new Date(latest.expiresDate)
        : null;
      if (status === 'grace' && last?.signedRenewalInfo) {
        const renewal = await target.verifier.verifyAndDecodeRenewalInfo(
          last.signedRenewalInfo,
        );
        if (renewal.gracePeriodExpiresDate) {
          currentPeriodEnd = new Date(renewal.gracePeriodExpiresDate);
        }
      }
      return {
        storeRef: tx.originalTransactionId,
        productId: latest.productId ?? tx.productId,
        status,
        currentPeriodEnd,
        accountToken: latest.appAccountToken ?? tx.appAccountToken ?? null,
        sandbox: target.environment === Environment.SANDBOX,
      };
    } catch (error) {
      throw this.wrap(error);
    }
  }

  private wrap(error: unknown): Error {
    if (
      error instanceof StoreRejectedError ||
      error instanceof StoreUnavailableError ||
      error instanceof StoreUnverifiedError
    ) {
      return error;
    }
    if (error instanceof APIException) {
      const retryable =
        error.httpStatusCode === 429 || error.httpStatusCode >= 500;
      return retryable
        ? new StoreUnavailableError(`Apple API ${error.httpStatusCode}`)
        : new StoreRejectedError(`Apple API ${error.apiError}`);
    }
    if (error instanceof VerificationException) {
      return error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
        ? new StoreUnavailableError('Apple verification could not complete')
        : new StoreRejectedError(`Apple verification failed (${error.status})`);
    }
    return new StoreUnavailableError('Apple request failed');
  }
}

// Google Play

const GOOGLE_STATES: Record<string, SubscriptionStatus> = {
  SUBSCRIPTION_STATE_ACTIVE: 'active',
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'grace',
  // Canceled but not yet expired: access continues until the expiry time.
  SUBSCRIPTION_STATE_CANCELED: 'active',
};

export class GooglePlayStore {
  private readonly play: androidpublisher_v3.Androidpublisher;
  private readonly oidc = new OAuth2Client();

  constructor(private readonly env: Env) {
    const googleAuth = new auth.GoogleAuth({
      credentials: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON!) as Record<
        string,
        string
      >,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    this.play = androidpublisher({ version: 'v3', auth: googleAuth });
  }

  static configured(env: Env): boolean {
    return Boolean(
      env.GOOGLE_PACKAGE_NAME &&
      env.GOOGLE_SERVICE_ACCOUNT_JSON &&
      env.GOOGLE_PUBSUB_AUDIENCE &&
      env.GOOGLE_PUBSUB_SERVICE_ACCOUNT,
    );
  }

  async lookup(purchaseToken: string): Promise<StoreSubscription> {
    let data: androidpublisher_v3.Schema$SubscriptionPurchaseV2;
    try {
      ({ data } = await this.play.purchases.subscriptionsv2.get({
        packageName: this.env.GOOGLE_PACKAGE_NAME!,
        token: purchaseToken,
      }));
    } catch (error) {
      const code = (error as { code?: number }).code ?? 0;
      throw code === 429 || code >= 500 || code === 0
        ? new StoreUnavailableError(`Google Play ${code}`)
        : new StoreRejectedError(`Google Play ${code}`);
    }
    const item = data.lineItems?.[0];
    if (!item?.productId) {
      throw new StoreRejectedError('Purchase without a product');
    }
    const expiry = item.expiryTime ? new Date(item.expiryTime) : null;
    return {
      storeRef: purchaseToken,
      productId: item.productId,
      status: GOOGLE_STATES[data.subscriptionState ?? ''] ?? 'expired',
      currentPeriodEnd: expiry,
      accountToken:
        data.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
      sandbox: data.testPurchase !== undefined && data.testPurchase !== null,
      replacesStoreRef: data.linkedPurchaseToken ?? null,
      needsAcknowledgement:
        data.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING',
    };
  }

  /** Unacknowledged purchases are refunded by Google after three days. */
  async acknowledge(productId: string, purchaseToken: string): Promise<void> {
    try {
      await this.play.purchases.subscriptions.acknowledge({
        packageName: this.env.GOOGLE_PACKAGE_NAME!,
        subscriptionId: productId,
        token: purchaseToken,
        requestBody: {},
      });
    } catch (error) {
      const code = (error as { code?: number }).code ?? 0;
      throw code === 429 || code >= 500 || code === 0
        ? new StoreUnavailableError(`Google Play ${code}`)
        : new StoreRejectedError(`Google Play ${code}`);
    }
  }

  /**
   * Pub/Sub push with an OIDC token: verify signature, expiry, issuer and audience (always
   * passed: without it the library skips the audience check), and the push service account.
   */
  async verifyPush(authorization: string | undefined): Promise<boolean> {
    const match = /^Bearer (.+)$/.exec(authorization ?? '');
    if (!match) {
      return false;
    }
    try {
      const ticket = await this.oidc.verifyIdToken({
        idToken: match[1],
        audience: this.env.GOOGLE_PUBSUB_AUDIENCE!,
      });
      const payload = ticket.getPayload();
      return (
        payload?.email === this.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT &&
        payload?.email_verified === true
      );
    } catch {
      return false;
    }
  }

  get packageName(): string {
    return this.env.GOOGLE_PACKAGE_NAME!;
  }
}
