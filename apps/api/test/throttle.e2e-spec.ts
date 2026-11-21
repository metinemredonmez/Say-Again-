import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { createApp } from './support/app.js';

// Rate limits are on in this file only (RES-01).
describe('Rate limits (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.THROTTLE_IN_TESTS = 'true';
    ({ app } = await createApp());
  });

  afterAll(async () => {
    delete process.env.THROTTLE_IN_TESTS;
    await app.close();
  });

  it('allows ten anonymous accounts an hour from one address, then answers 429', async () => {
    const first = await request(app.getHttpServer())
      .post('/auth/device')
      .send({})
      .expect(201);
    expect(first.headers['x-ratelimit-limit']).toBe('10');
    for (let i = 1; i < 10; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/device')
        .send({})
        .expect(201);
    }
    const res = await request(app.getHttpServer())
      .post('/auth/device')
      .send({})
      .expect(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('ignores a client-supplied X-Forwarded-For (no trust proxy configured)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/device')
      .set('X-Forwarded-For', '203.0.113.77')
      .send({})
      .expect(429);
    expect(res.body.statusCode).toBe(429);
  });
});
