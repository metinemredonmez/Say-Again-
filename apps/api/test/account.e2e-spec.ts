import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types.js';
import type { Database } from '../src/database/database.js';
import {
  lessons,
  phrases,
  refreshTokens,
  users,
} from '../src/database/schema.js';
import { completeLesson, createApp, registerDevice } from './support/app.js';

describe('Accounts, tokens and stores (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    ({ app, db } = await createApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an anonymous account with settings and validates them', async () => {
    const res = await request(server())
      .post('/auth/device')
      .send({ level: 'B2', pack: 'seller', difficulty: 'hard' })
      .expect(201);
    expect(res.body.user).toMatchObject({
      level: 'B2',
      pack: 'seller',
      difficulty: 'hard',
      targetLanguage: 'en',
    });
    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: 900,
    });
    await request(server())
      .post('/auth/device')
      .send({ level: 'Z9' })
      .expect(400);
    await request(server())
      .post('/auth/device')
      .send({ isAdmin: true })
      .expect(400); // no mass assignment
  });

  it('rotates refresh tokens and revokes the family when a used token comes back', async () => {
    const device = await registerDevice(app);
    const first = await request(server())
      .post('/auth/token/refresh')
      .send({ refreshToken: device.refreshToken })
      .expect(200);
    await request(server())
      .get('/me')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .expect(200);

    // Replaying the spent token: a thief or a bug. The whole family is revoked.
    await request(server())
      .post('/auth/token/refresh')
      .send({ refreshToken: device.refreshToken })
      .expect(401);
    await request(server())
      .post('/auth/token/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(401);
  });

  it('rejects tampered and foreign tokens', async () => {
    const device = await registerDevice(app);
    const [header, payload] = device.accessToken.split('.');
    await request(server())
      .get('/me')
      .set('Authorization', `Bearer ${header}.${payload}.forged-signature`)
      .expect(401);
    const none = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    await request(server())
      .get('/me')
      .set('Authorization', `Bearer ${none}.${payload}.`)
      .expect(401);
  });

  it('updates settings without touching protected fields', async () => {
    const device = await registerDevice(app);
    const res = await request(server())
      .patch('/me')
      .set(device.auth)
      .send({ difficulty: 'hard' })
      .expect(200);
    expect(res.body.user.difficulty).toBe('hard');
    await request(server()).patch('/me').set(device.auth).send({}).expect(200);
    await request(server())
      .patch('/me')
      .set(device.auth)
      .send({ targetLanguage: 'de' })
      .expect(400);
  });

  it('deletes the account with all its data, and its tokens stop working', async () => {
    const device = await registerDevice(app);
    await completeLesson(app, device);
    await request(server()).delete('/me').set(device.auth).expect(204);

    expect(
      await db.select().from(users).where(eq(users.id, device.userId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(lessons).where(eq(lessons.userId, device.userId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(phrases).where(eq(phrases.userId, device.userId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, device.userId)),
    ).toHaveLength(0);
    await request(server()).get('/me').set(device.auth).expect(401);
    await request(server())
      .post('/auth/token/refresh')
      .send({ refreshToken: device.refreshToken })
      .expect(401);
  });

  it('refuses store calls while store verification is not configured, and unauthenticated webhooks', async () => {
    const device = await registerDevice(app);
    const apple = await request(server())
      .post('/subscriptions/apple')
      .set(device.auth)
      .send({ transactionId: '2000000123456789' })
      .expect(503);
    expect(apple.body.code).toBe('store_not_configured');
    await request(server())
      .post('/subscriptions/apple')
      .set(device.auth)
      .send({ transactionId: 'not-a-number' })
      .expect(400);
    await request(server())
      .post('/webhooks/app-store')
      .send({ signedPayload: 'eyJhbGciOiJFUzI1NiJ9.x.y' })
      .expect(401);
    await request(server())
      .post('/webhooks/google-play')
      .set('Authorization', 'Bearer forged')
      .send({ message: { data: '' } })
      .expect(401);
  });
});
