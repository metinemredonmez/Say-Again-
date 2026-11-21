import { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import type { Database } from '../../src/database/database.js';

/** The real AppModule on an in-memory PGlite database with mock AI (see vitest.config.e2e.ts). */
export async function createApp(): Promise<{
  app: INestApplication<App>;
  db: Database;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return { app, db: app.get<Database>(getDrizzleToken()) };
}

export interface Device {
  userId: string;
  accessToken: string;
  refreshToken: string;
  auth: { Authorization: string };
}

export async function registerDevice(
  app: INestApplication<App>,
  settings: object = {},
): Promise<Device> {
  const res = await request(app.getHttpServer())
    .post('/auth/device')
    .send(settings)
    .expect(201);
  const body = res.body as {
    user: { id: string };
    accessToken: string;
    refreshToken: string;
  };
  return {
    userId: body.user.id,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    auth: { Authorization: `Bearer ${body.accessToken}` },
  };
}

/** A minimal buffer with an MP4 (m4a) signature, as Expo records on iOS and Android. */
export function fakeM4a(): Buffer {
  const data = Buffer.alloc(2048, 0);
  data.writeUInt32BE(32, 0);
  data.write('ftypM4A ', 4, 'latin1');
  return data;
}

/** Runs a whole lesson with typed answers and returns its id. */
export async function completeLesson(
  app: INestApplication<App>,
  device: Device,
  scenarioId = 'pro-interview-01',
) {
  const server = app.getHttpServer();
  const start = await request(server)
    .post('/lessons?audio=false')
    .set(device.auth)
    .send({ scenarioId })
    .expect(201);
  const id = (start.body as { lesson: { id: string } }).lesson.id;
  await request(server)
    .post(`/lessons/${id}/turns?audio=false`)
    .set(device.auth)
    .send({ text: 'I am working here since three years.' })
    .expect(200);
  await request(server)
    .post(`/lessons/${id}/turns?audio=false`)
    .set(device.auth)
    .send({ text: 'I like my team a lot.' })
    .expect(200);
  await request(server)
    .post(`/lessons/${id}/finish`)
    .set(device.auth)
    .expect(200);
  await request(server)
    .post(`/lessons/${id}/resay`)
    .set(device.auth)
    .send({ text: 'I have been working here for three years.' })
    .expect(200);
  return id;
}
