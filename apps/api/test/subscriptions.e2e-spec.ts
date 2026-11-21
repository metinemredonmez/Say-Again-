import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types.js';
import type { Database } from '../src/database/database.js';
import { subscriptions } from '../src/database/schema.js';
import {
  StoreUnverifiedError,
  type StoreSubscription,
} from '../src/subscriptions/stores.js';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service.js';
import { completeLesson, createApp, registerDevice } from './support/app.js';

// The store clients are replaced by fakes; the linking rules, the database constraints and the
// HTTP layer are real.
describe('Store subscriptions (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const server = () => app.getHttpServer();
  const inAMonth = () => new Date(Date.now() + 30 * 86_400_000);

  const apple = {
    lookup: vi.fn<(id: string) => Promise<StoreSubscription>>(),
    verifySignedTransaction:
      vi.fn<(jws: string) => Promise<StoreSubscription>>(),
    fromNotification: vi.fn<(p: string) => Promise<StoreSubscription | null>>(),
    setAccountToken: vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(),
  };
  const google = {
    lookup: vi.fn<(token: string) => Promise<StoreSubscription>>(),
    acknowledge: vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(),
    verifyPush: vi.fn<(auth?: string) => Promise<boolean>>(),
    packageName: 'app.sayagain',
  };
  const purchase = (over: Partial<StoreSubscription>): StoreSubscription => ({
    storeRef: '1000000000000001',
    productId: 'say_again_monthly',
    status: 'active',
    currentPeriodEnd: inAMonth(),
    accountToken: null,
    sandbox: false,
    ...over,
  });

  beforeAll(async () => {
    ({ app, db } = await createApp());
    const service = app.get(SubscriptionsService) as unknown as Record<
      string,
      unknown
    >;
    service.apple = apple;
    service.google = google;
  });

  afterAll(async () => {
    await app.close();
  });

  it('links a purchase made for this account and unlocks 20 lessons a month', async () => {
    const ada = await registerDevice(app);
    for (const id of [
      'pro-interview-01',
      'pro-interview-02',
      'pro-meeting-01',
    ]) {
      await completeLesson(app, ada, id); // the three free lessons this month
    }
    apple.lookup.mockResolvedValueOnce(
      purchase({ storeRef: 'ada-1', accountToken: ada.userId }),
    );
    const res = await request(server())
      .post('/subscriptions/apple')
      .set(ada.auth)
      .send({ transactionId: '2000000000000001' })
      .expect(200);
    expect(res.body.subscription).toMatchObject({
      store: 'app_store',
      status: 'active',
    });

    const me = await request(server()).get('/me').set(ada.auth).expect(200);
    // Free lessons done earlier this month do not use up the subscription.
    expect(me.body.quota).toMatchObject({
      plan: 'subscribed',
      remaining: 20,
      limit: 20,
    });
    await request(server())
      .post('/lessons?audio=false')
      .set(ada.auth)
      .send({ scenarioId: 'pro-daily-01' })
      .expect(201);
  });

  it("refuses another account's purchase unless it is restored with the store's proof", async () => {
    const owner = await registerDevice(app);
    const other = await registerDevice(app);
    apple.lookup.mockResolvedValue(
      purchase({ storeRef: 'owner-1', accountToken: owner.userId }),
    );
    await request(server())
      .post('/subscriptions/apple')
      .set(owner.auth)
      .send({ transactionId: '2000000000000002' })
      .expect(200);

    // A bare transaction id from another account is not proof of ownership.
    const refused = await request(server())
      .post('/subscriptions/apple')
      .set(other.auth)
      .send({ transactionId: '2000000000000002' })
      .expect(409);
    expect(refused.body.code).toBe('purchase_other_account');
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.storeRef, 'owner-1'));
    expect(row.userId).toBe(owner.userId);

    // Restore with the transaction signed on the device (a reinstall: the old account is lost).
    apple.verifySignedTransaction.mockResolvedValueOnce(
      purchase({ storeRef: 'owner-1', accountToken: owner.userId }),
    );
    await request(server())
      .post('/subscriptions/apple')
      .set(other.auth)
      .send({ signedTransaction: 'eyJhbGciOiJFUzI1NiJ9.signed-on-device.sig' })
      .expect(200);
    const [moved] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.storeRef, 'owner-1'));
    expect(moved.userId).toBe(other.userId);
    expect(apple.setAccountToken).toHaveBeenCalledWith(
      'owner-1',
      other.userId,
      false,
    );
  });

  it('moves a resubscription to the account named by the store', async () => {
    const first = await registerDevice(app);
    const second = await registerDevice(app);
    apple.lookup.mockResolvedValueOnce(
      purchase({
        storeRef: 'resub-1',
        accountToken: first.userId,
        status: 'expired',
      }),
    );
    await request(server())
      .post('/subscriptions/apple')
      .set(first.auth)
      .send({ transactionId: '2000000000000003' })
      .expect(200);

    // The same subscription bought again from the second account: Apple now names it.
    apple.lookup.mockResolvedValueOnce(
      purchase({ storeRef: 'resub-1', accountToken: second.userId }),
    );
    await request(server())
      .post('/subscriptions/apple')
      .set(second.auth)
      .send({ transactionId: '2000000000000004' })
      .expect(200);
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.storeRef, 'resub-1'));
    expect(row).toMatchObject({ userId: second.userId, status: 'active' });

    // A later notification keeps it with the account Apple names.
    apple.fromNotification.mockResolvedValueOnce(
      purchase({
        storeRef: 'resub-1',
        accountToken: second.userId,
        status: 'grace',
      }),
    );
    await request(server())
      .post('/webhooks/app-store')
      .send({ signedPayload: 'eyJ.notification.sig' })
      .expect(200);
    const [after] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.storeRef, 'resub-1'));
    expect(after).toMatchObject({ userId: second.userId, status: 'grace' });
  });

  it('answers 401 to a notification that is not from Apple', async () => {
    apple.fromNotification.mockRejectedValueOnce(
      new StoreUnverifiedError('bad chain'),
    );
    await request(server())
      .post('/webhooks/app-store')
      .send({ signedPayload: 'eyJ.forged.sig' })
      .expect(401);
  });

  it('acknowledges a Google purchase, and restores it with the purchase token', async () => {
    const buyer = await registerDevice(app);
    const reinstalled = await registerDevice(app);
    google.lookup.mockResolvedValue(
      purchase({
        storeRef: 'play-token-0123456789',
        accountToken: buyer.userId,
        needsAcknowledgement: true,
      }),
    );
    await request(server())
      .post('/subscriptions/google')
      .set(buyer.auth)
      .send({ purchaseToken: 'play-token-0123456789' })
      .expect(200);
    expect(google.acknowledge).toHaveBeenCalledWith(
      'say_again_monthly',
      'play-token-0123456789',
    );

    await request(server())
      .post('/subscriptions/google')
      .set(reinstalled.auth)
      .send({ purchaseToken: 'play-token-0123456789' })
      .expect(409);
    await request(server())
      .post('/subscriptions/google')
      .set(reinstalled.auth)
      .send({ purchaseToken: 'play-token-0123456789', restore: true })
      .expect(200);
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.storeRef, 'play-token-0123456789'));
    expect(row.userId).toBe(reinstalled.userId);

    // RTDN: authenticated, and the restored owner keeps it (Google's account id never changes).
    google.verifyPush.mockResolvedValueOnce(true);
    google.lookup.mockResolvedValueOnce(
      purchase({
        storeRef: 'play-token-0123456789',
        accountToken: buyer.userId,
        status: 'expired',
      }),
    );
    const data = Buffer.from(
      JSON.stringify({
        packageName: 'app.sayagain',
        subscriptionNotification: { purchaseToken: 'play-token-0123456789' },
      }),
    ).toString('base64');
    await request(server())
      .post('/webhooks/google-play')
      .set('Authorization', 'Bearer oidc')
      .send({ message: { data } })
      .expect(204);
    const [after] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.storeRef, 'play-token-0123456789'));
    expect(after).toMatchObject({
      userId: reinstalled.userId,
      status: 'expired',
    });
  });

  it('refuses products that are not this app’s subscription', async () => {
    const user = await registerDevice(app);
    apple.lookup.mockResolvedValueOnce(
      purchase({
        storeRef: 'other-product',
        productId: 'coins_100',
        accountToken: user.userId,
      }),
    );
    const res = await request(server())
      .post('/subscriptions/apple')
      .set(user.auth)
      .send({ transactionId: '2000000000000009' })
      .expect(422);
    expect(res.body.code).toBe('unknown_product');
  });
});
