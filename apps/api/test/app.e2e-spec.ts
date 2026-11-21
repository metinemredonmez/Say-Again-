import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/configure-app.js';

describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health answers ok with no dependency details', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      info: {},
      error: {},
      details: {},
    });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('GET /scenarios lists all scenarios without the transfer task', async () => {
    const res = await request(app.getHttpServer())
      .get('/scenarios')
      .expect(200);
    const scenarios = (res.body as { scenarios: Record<string, unknown>[] })
      .scenarios;
    expect(scenarios).toHaveLength(20);
    expect(scenarios[0]).toMatchObject({
      id: 'pro-interview-01',
      pack: 'professional',
      targetLanguage: 'en',
    });
    expect(JSON.stringify(res.body)).not.toContain(
      'Nice to meet you! So, what do you do?',
    );
    for (const s of scenarios) {
      expect(s).not.toHaveProperty('transfer');
      expect(s).not.toHaveProperty('coachRole');
    }
  });

  it('GET /scenarios?pack=seller filters by pack', async () => {
    const res = await request(app.getHttpServer())
      .get('/scenarios?pack=seller')
      .expect(200);
    expect((res.body as { scenarios: unknown[] }).scenarios).toHaveLength(8);
  });

  it('GET /scenarios rejects an unknown or malformed pack', async () => {
    await request(app.getHttpServer())
      .get('/scenarios?pack=teacher')
      .expect(400);
    await request(app.getHttpServer())
      .get('/scenarios?pack=../etc')
      .expect(400);
    await request(app.getHttpServer())
      .get('/scenarios?pack=seller&pack=professional')
      .expect(400);
  });

  it('GET /scenarios/:id returns one scenario without the transfer task', async () => {
    const res = await request(app.getHttpServer())
      .get('/scenarios/pro-interview-01')
      .expect(200);
    expect(res.body).toMatchObject({
      id: 'pro-interview-01',
      opening: expect.any(String),
    });
    expect(res.body).not.toHaveProperty('transfer');
    expect(res.body).not.toHaveProperty('hints');
  });

  it('GET /scenarios/:id answers 404 for an unknown id and 400 for a malformed one', async () => {
    const missing = await request(app.getHttpServer())
      .get('/scenarios/pro-interview-99')
      .expect(404);
    expect(missing.body).toEqual({
      statusCode: 404,
      message: 'Scenario not found',
      error: 'Not Found',
    });
    await request(app.getHttpServer()).get('/scenarios/Bad%20Id').expect(400);
  });

  it('removed the template sample route', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(404);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules/);
  });
});
