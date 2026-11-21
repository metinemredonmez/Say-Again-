import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication, Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types.js';
import type { Database } from '../src/database/database.js';
import { aiSpend, reviewItems } from '../src/database/schema.js';
import { completeLesson, createApp, registerDevice } from './support/app.js';

// Security controls from the red-team catalogue (docs/08-guvenlik.md). Each negative case first
// shows the legitimate request working on the same build, then changes one thing.

const SECRET = 'test-only-jwt-secret-of-at-least-32-bytes'; // vitest.config.e2e.ts

function sign(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'at+jwt' },
  secret = SECRET,
): string {
  const part = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${part(header)}.${part(claims)}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}

/** Every route the running app serves, as "METHOD /path". */
function liveRoutes(app: INestApplication<App>): string[] {
  const express = app.getHttpAdapter().getInstance() as {
    router: {
      stack: {
        route?: { path: string; methods: Record<string, boolean> };
      }[];
    };
  };
  const routes = new Set<string>();
  for (const layer of express.router.stack) {
    if (!layer.route) continue;
    for (const [method, on] of Object.entries(layer.route.methods)) {
      if (on && method !== '_all') {
        routes.add(`${method.toUpperCase()} ${layer.route.path}`);
      }
    }
  }
  return [...routes].sort();
}

// Routes that work without an access token. Everything else must answer 401 to a stranger.
const PUBLIC = new Set([
  'GET /health',
  'GET /scenarios',
  'GET /scenarios/:id',
  'POST /auth/device',
  'POST /auth/token/refresh',
  'POST /auth/sign-out',
  'POST /webhooks/app-store',
  'POST /webhooks/google-play',
]);

describe('Security controls (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const server = () => app.getHttpServer();
  const now = () => Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    ({ app, db } = await createApp());
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => vi.restoreAllMocks());

  it('serves exactly the documented routes, and only the public ones without a token (API-01)', async () => {
    const live = liveRoutes(app);
    const docs = readFileSync(
      join(import.meta.dirname, '../../../docs/03-mimari.md'),
      'utf8',
    );
    const documented = [
      ...docs.matchAll(/`(GET|POST|PATCH|PUT|DELETE) (\/[^`?\s]*)/g),
    ]
      .map(([, method, path]) => `${method} ${path}`)
      .sort();
    expect(live).toEqual([...new Set(documented)]);

    for (const route of live.filter((r) => !PUBLIC.has(r))) {
      const [method, path] = route.split(' ');
      const url = path.replace(':id', '6a0f0b8e-0000-4000-8000-000000000000');
      const res = await request(server())
        [method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](url)
        .send({});
      expect({ route, status: res.status }).toEqual({ route, status: 401 });
    }
  });

  it('checks signature, type, issuer, audience and expiry of access tokens (TOK-01)', async () => {
    const device = await registerDevice(app);
    const claims = {
      sub: device.userId,
      iss: 'say-again-api',
      aud: 'say-again-app',
      iat: now(),
      exp: now() + 600,
    };
    const me = (token: string) =>
      request(server()).get('/me').set('Authorization', `Bearer ${token}`);

    // The legitimate token, built by hand, works: the forgeries below differ in one thing.
    await me(sign(claims)).expect(200);

    await me(sign(claims, { alg: 'HS256', typ: 'JWT' })).expect(401);
    await me(sign(claims, { alg: 'HS512', typ: 'at+jwt' })).expect(401);
    await me(sign(claims, { alg: 'none', typ: 'at+jwt' })).expect(401);
    await me(sign({ ...claims, iss: 'someone-else' })).expect(401);
    await me(sign({ ...claims, aud: 'another-app' })).expect(401);
    await me(sign({ ...claims, exp: now() - 60 })).expect(401);
    await me(sign({ ...claims, sub: undefined })).expect(401);
    // KEY-03: after a key change, tokens signed with the old key stop working.
    await me(
      sign(claims, undefined, 'an-old-or-leaked-secret-of-at-least-32-bytes'),
    ).expect(401);
  });

  it('keeps access and refresh tokens apart, and takes tokens only from the header (TOK-02, SES-01)', async () => {
    const device = await registerDevice(app);
    await request(server())
      .post('/auth/token/refresh')
      .send({ refreshToken: device.accessToken })
      .expect(401);
    await request(server())
      .get('/me')
      .set('Authorization', `Bearer ${device.refreshToken}`)
      .expect(401);
    await request(server())
      .get(`/me?access_token=${device.accessToken}`)
      .expect(401);
    await request(server()).get('/me').set(device.auth).expect(200);
  });

  it('tags every answer with a request id and logs refresh-token reuse as an alert (LOG-01)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const device = await registerDevice(app);
    await request(server())
      .post('/auth/token/refresh')
      .send({ refreshToken: device.refreshToken })
      .expect(200);
    const reuse = await request(server())
      .post('/auth/token/refresh')
      .send({ refreshToken: device.refreshToken })
      .expect(401);

    const requestId = reuse.headers['x-request-id'];
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const alert = warn.mock.calls
      .map(([entry]) => entry as Record<string, unknown>)
      .find((entry) => entry?.event === 'auth.refresh_reused');
    expect(alert).toMatchObject({
      outcome: 'alert',
      actor: device.userId,
      requestId,
      path: '/auth/token/refresh',
    });
    // LOG-02: the token itself is never logged.
    expect(JSON.stringify(warn.mock.calls)).not.toContain(device.refreshToken);
  });

  it('ignores a client-chosen request id', async () => {
    const res = await request(server())
      .get('/health')
      .set('X-Request-Id', 'forged-id')
      .expect(200);
    expect(res.headers['x-request-id']).not.toBe('forged-id');
  });

  it('keeps the spend of deleted accounts in the global budget (RES-01)', async () => {
    const spender = await registerDevice(app);
    const [row] = await db
      .insert(aiSpend)
      .values({
        userId: spender.userId,
        source: 'evaluator',
        costMicroUsd: 100_000_000, // the whole $100 global budget
      })
      .returning({ id: aiSpend.id });
    try {
      await request(server()).delete('/me').set(spender.auth).expect(204);
      const next = await registerDevice(app);
      const res = await request(server())
        .post('/lessons?audio=false')
        .set(next.auth)
        .send({ scenarioId: 'pro-daily-01' })
        .expect(503);
      expect(res.body.code).toBe('service_busy');
    } finally {
      await db.delete(aiSpend).where(inArray(aiSpend.id, [row.id]));
    }
  });

  it('rejects unknown query parameters (INP-01)', async () => {
    await request(server()).get('/scenarios?pack=seller').expect(200);
    await request(server()).get('/scenarios?pack=seller&debug=1').expect(400);
  });

  it('answers malformed JSON with a 400 and no internal detail (EXC-01)', async () => {
    const res = await request(server())
      .post('/auth/device')
      .set('content-type', 'application/json')
      .send('{"level":')
      .expect(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js|node_modules/);
  });

  it("keeps one user's review items, lessons and reports away from another (AZ-01, AZ-04)", async () => {
    const owner = await registerDevice(app);
    const stranger = await registerDevice(app);
    const lessonId = await completeLesson(app, owner);
    // Make the owner's items due now, so only ownership can stop the stranger.
    const items = await db
      .update(reviewItems)
      .set({ dueAt: new Date(Date.now() - 60_000) })
      .where(eq(reviewItems.userId, owner.userId))
      .returning({ id: reviewItems.id, kind: reviewItems.kind });
    const transfer = items.find((i) => i.kind === 'transfer')!;
    const review = items.find((i) => i.kind === 'review')!;

    // The stranger is refused (404, as if nothing existed) and nothing changes.
    await request(server())
      .post(`/review-items/${transfer.id}/hint`)
      .set(stranger.auth)
      .expect(404);
    await request(server())
      .post(`/review-items/${review.id}/result`)
      .set(stranger.auth)
      .send({ outcome: 'unaided' })
      .expect(404);
    await request(server())
      .get(`/lessons/${lessonId}`)
      .set(stranger.auth)
      .expect(404);
    await request(server())
      .post('/reports')
      .set(stranger.auth)
      .send({ target: 'correction', lessonId, reason: 'wrong' })
      .expect(404);
    const after = await db
      .select({ doneAt: reviewItems.doneAt, hintUsed: reviewItems.hintUsed })
      .from(reviewItems)
      .where(eq(reviewItems.userId, owner.userId));
    expect(after.every((i) => i.doneAt === null && !i.hintUsed)).toBe(true);

    // The owner can use the same item.
    await request(server())
      .post(`/review-items/${transfer.id}/hint`)
      .set(owner.auth)
      .expect(200);
  });

  it('refuses request bodies over the size limit before parsing them (INP-04)', async () => {
    await request(server())
      .post('/auth/device')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ level: 'B1', padding: 'x'.repeat(200_000) }))
      .expect(413);
  });
});
