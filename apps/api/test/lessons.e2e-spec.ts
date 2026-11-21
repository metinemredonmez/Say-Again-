import { INestApplication } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { MOCK_TRANSCRIPT } from '../src/ai/mock-providers.js';
import type { Database } from '../src/database/database.js';
import { corrections, lessons, reviewItems } from '../src/database/schema.js';
import {
  completeLesson,
  createApp,
  fakeM4a,
  registerDevice,
  type Device,
} from './support/app.js';

describe('Lesson flow (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let ada: Device;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    ({ app, db } = await createApp());
    ada = await registerDevice(app, { level: 'B1', pack: 'professional' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects requests without a token, and serves the public catalogue', async () => {
    await request(server()).get('/me').expect(401);
    await request(server())
      .post('/lessons')
      .send({ scenarioId: 'pro-interview-01' })
      .expect(401);
    await request(server()).get('/scenarios').expect(200);
    await request(server()).get('/health').expect(200);
  });

  it('runs a whole lesson: opening, one follow-up, closing, one correction, resay', async () => {
    const start = await request(server())
      .post('/lessons')
      .set(ada.auth)
      .send({ scenarioId: 'pro-interview-01' })
      .expect(201);
    const lessonId: string = start.body.lesson.id;
    expect(start.body.coach).toMatchObject({
      move: 'opening',
      text: expect.stringContaining('tell me a little about yourself'),
    });
    expect(start.body.coach.audio).toMatchObject({
      mimeType: 'audio/mpeg',
      base64: expect.any(String),
    });
    expect(start.body.hints.length).toBeGreaterThan(0); // easy mode

    // A second lesson cannot be started over this one's resay later, but can replace it now.
    const first = await request(server())
      .post(`/lessons/${lessonId}/turns?audio=false`)
      .set(ada.auth)
      .send({ text: 'I am working here since three years.' })
      .expect(200);
    expect(first.body.coach.move).toBe('follow_up');
    expect(first.body.closed).toBe(false);

    const second = await request(server())
      .post(`/lessons/${lessonId}/turns?audio=false`)
      .set(ada.auth)
      .send({ text: 'I enjoy working with my team.' })
      .expect(200);
    expect(second.body.coach.move).toBe('closing'); // no second question
    expect(second.body.closed).toBe(true);

    const extra = await request(server())
      .post(`/lessons/${lessonId}/turns?audio=false`)
      .set(ada.auth)
      .send({ text: 'One more thing.' })
      .expect(409);
    expect(extra.body.code).toBe('lesson_closed');

    const finish = await request(server())
      .post(`/lessons/${lessonId}/finish`)
      .set(ada.auth)
      .expect(200);
    expect(finish.body.correction).toMatchObject({
      kind: 'correction',
      original: 'I am working here since three years.',
      improved: 'I have been working here for three years.',
      category: 'tense',
    });
    const again = await request(server())
      .post(`/lessons/${lessonId}/finish`)
      .set(ada.auth)
      .expect(200);
    expect(again.body.correction.id).toBe(finish.body.correction.id); // idempotent, one correction

    // The lesson is not done until the idea is said again.
    const blocked = await request(server())
      .post('/lessons')
      .set(ada.auth)
      .send({ scenarioId: 'pro-meeting-01' })
      .expect(409);
    expect(blocked.body).toMatchObject({ code: 'resay_pending', lessonId });
    const today = await request(server())
      .get('/today')
      .set(ada.auth)
      .expect(200);
    expect(today.body.primary).toBe('resay');

    const short = await request(server())
      .post(`/lessons/${lessonId}/resay`)
      .set(ada.auth)
      .send({ text: 'Yes' })
      .expect(422);
    expect(short.body.code).toBe('resay_too_short');

    const resay = await request(server())
      .post(`/lessons/${lessonId}/resay`)
      .set(ada.auth)
      .send({ text: 'I have been working here for three years.' })
      .expect(200);
    expect(resay.body.lesson.state).toBe('completed');
    expect(resay.body.phrase.text).toBe(
      'I have been working here for three years.',
    );
    const days = (resay.body.reviews as { kind: string; dueAt: string }[]).map(
      (r) => ({
        kind: r.kind,
        days: Math.round(
          (Date.parse(r.dueAt) - Date.parse(resay.body.lesson.completedAt)) /
            86_400_000,
        ),
      }),
    );
    expect(days).toEqual(
      expect.arrayContaining([
        { kind: 'review', days: 1 },
        { kind: 'review', days: 3 },
        { kind: 'transfer', days: 3 },
        { kind: 'review', days: 7 },
      ]),
    );
    expect(days).toHaveLength(4);

    const detail = await request(server())
      .get(`/lessons/${lessonId}`)
      .set(ada.auth)
      .expect(200);
    expect(
      detail.body.turns.map((t: { speaker: string }) => t.speaker),
    ).toEqual(['coach', 'learner', 'coach', 'learner', 'coach']);
    const phrases = await request(server())
      .get('/phrases')
      .set(ada.auth)
      .expect(200);
    expect(phrases.body.phrases).toHaveLength(1);
  });

  it('accepts a recording, transcribes it in memory, and refuses files that are not audio', async () => {
    const start = await request(server())
      .post('/lessons?audio=false')
      .set(ada.auth)
      .send({ scenarioId: 'pro-meeting-01' })
      .expect(201);
    const id: string = start.body.lesson.id;

    const spoken = await request(server())
      .post(`/lessons/${id}/turns?audio=false`)
      .set(ada.auth)
      .attach('audio', fakeM4a(), {
        filename: 'clip.m4a',
        contentType: 'audio/mp4',
      })
      .expect(200);
    expect(spoken.body.learner).toEqual({
      text: MOCK_TRANSCRIPT,
      fromAudio: true,
    });

    const notAudio = await request(server())
      .post(`/lessons/${id}/turns?audio=false`)
      .set(ada.auth)
      .attach('audio', Buffer.from('<?php echo "x"; ?>'.repeat(64)), {
        filename: 'clip.m4a',
        contentType: 'audio/mp4',
      })
      .expect(422);
    expect(notAudio.body.code).toBe('invalid_audio');

    const both = await request(server())
      .post(`/lessons/${id}/turns?audio=false`)
      .set(ada.auth)
      .field('text', 'Hello there')
      .attach('audio', fakeM4a(), {
        filename: 'clip.m4a',
        contentType: 'audio/mp4',
      })
      .expect(400);
    expect(both.body.code).toBe('one_answer_only');

    const tooBig = Buffer.concat([fakeM4a(), Buffer.alloc(6 * 1024 * 1024)]);
    await request(server())
      .post(`/lessons/${id}/turns?audio=false`)
      .set(ada.auth)
      .attach('audio', tooBig, {
        filename: 'clip.m4a',
        contentType: 'audio/mp4',
      })
      .expect(413);
  });

  it('keeps other users out of a lesson (404, as if it did not exist)', async () => {
    const eve = await registerDevice(app);
    const [own] = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.userId, ada.userId))
      .limit(1);
    await request(server()).get(`/lessons/${own.id}`).set(eve.auth).expect(404);
    await request(server())
      .post(`/lessons/${own.id}/turns?audio=false`)
      .set(eve.auth)
      .send({ text: 'Hi there' })
      .expect(404);
    await request(server())
      .post(`/lessons/${own.id}/finish`)
      .set(eve.auth)
      .expect(404);
    await request(server())
      .post('/reports')
      .set(eve.auth)
      .send({ target: 'correction', lessonId: own.id, reason: 'wrong' })
      .expect(404);
  });

  it('closes the lesson to new answers after 10 minutes, but still gives the correction', async () => {
    const bob = await registerDevice(app);
    const start = await request(server())
      .post('/lessons?audio=false')
      .set(bob.auth)
      .send({ scenarioId: 'pro-daily-01' })
      .expect(201);
    const id: string = start.body.lesson.id;
    await request(server())
      .post(`/lessons/${id}/turns?audio=false`)
      .set(bob.auth)
      .send({ text: 'I want to change my dates.' })
      .expect(200);
    await db
      .update(lessons)
      .set({ startedAt: sql`now() - interval '11 minutes'` })
      .where(eq(lessons.id, id));

    const late = await request(server())
      .post(`/lessons/${id}/turns?audio=false`)
      .set(bob.auth)
      .send({ text: 'Is that possible?' })
      .expect(409);
    expect(late.body.code).toBe('lesson_time_over');
    await request(server())
      .post(`/lessons/${id}/finish`)
      .set(bob.auth)
      .expect(200);
  });

  it('runs two finishes at once without a second correction', async () => {
    const cem = await registerDevice(app);
    const start = await request(server())
      .post('/lessons?audio=false')
      .set(cem.auth)
      .send({ scenarioId: 'pro-interview-02' })
      .expect(201);
    const id: string = start.body.lesson.id;
    await request(server())
      .post(`/lessons/${id}/turns?audio=false`)
      .set(cem.auth)
      .send({ text: 'We built a new app last year.' })
      .expect(200);
    const results = await Promise.all([
      request(server()).post(`/lessons/${id}/finish`).set(cem.auth),
      request(server()).post(`/lessons/${id}/finish`).set(cem.auth),
    ]);
    expect(results.map((r) => r.status)).toContain(200);
    for (const r of results) {
      expect([200, 409]).toContain(r.status);
    }
    const rows = await db
      .select()
      .from(corrections)
      .where(eq(corrections.lessonId, id));
    expect(rows).toHaveLength(1);
  });

  it('asks the transfer question three days later, without the earlier answer, and records the result', async () => {
    const dee = await registerDevice(app);
    await completeLesson(app, dee);
    // Nothing is due on the day of the lesson.
    const before = await request(server())
      .get('/today')
      .set(dee.auth)
      .expect(200);
    expect(before.body.primary).toBe('lesson');
    expect(before.body.transfers).toHaveLength(0);

    await db
      .update(reviewItems)
      .set({ dueAt: sql`now() - interval '1 minute'` })
      .where(eq(reviewItems.userId, dee.userId));
    const today = await request(server())
      .get('/today')
      .set(dee.auth)
      .expect(200);
    expect(today.body.primary).toBe('transfer');
    const [transfer] = today.body.transfers;
    expect(transfer.question).toBe('Nice to meet you! So, what do you do?');
    const shown = JSON.stringify(transfer);
    expect(shown).not.toContain('I have been working here for three years.'); // not the phrase
    expect(shown).not.toContain('I am working here since three years.'); // not the earlier answer
    // The phrase's reviews wait until the transfer is answered: they would give the answer away.
    expect(JSON.stringify(today.body)).not.toContain(
      'I have been working here for three years.',
    );
    expect(today.body.reviews).toHaveLength(0);

    const hint = await request(server())
      .post(`/review-items/${transfer.id}/hint`)
      .set(dee.auth)
      .expect(200);
    expect(hint.body.hints.length).toBeGreaterThan(0);
    const answer = await request(server())
      .post(`/review-items/${transfer.id}/answer`)
      .set(dee.auth)
      .send({
        text: 'I am a developer and I have worked at a bank for five years.',
      })
      .expect(200);
    expect(answer.body.outcome).toBe('hinted');
    await request(server())
      .post(`/review-items/${transfer.id}/answer`)
      .set(dee.auth)
      .send({ text: 'Again and again here.' })
      .expect(409);

    const afterTransfer = await request(server())
      .get('/today')
      .set(dee.auth)
      .expect(200);
    const [review] = afterTransfer.body.reviews;
    expect(review.phrase).toBe('I have been working here for three years.');
    await request(server())
      .post(`/review-items/${review.id}/result`)
      .set(dee.auth)
      .send({ outcome: 'failed' })
      .expect(200);
    const queued = await db
      .select()
      .from(reviewItems)
      .where(eq(reviewItems.userId, dee.userId));
    const nextDay = queued.filter(
      (q) =>
        q.doneAt === null && q.dueAt.getTime() > Date.now() + 23 * 3_600_000,
    );
    expect(nextDay.length).toBeGreaterThan(0); // a failed item comes back the next day
  });

  it('stops after the three free lessons until there is a subscription', async () => {
    const fay = await registerDevice(app);
    for (const scenarioId of [
      'pro-interview-01',
      'pro-interview-02',
      'pro-meeting-01',
    ]) {
      await completeLesson(app, fay, scenarioId);
    }
    const me = await request(server()).get('/me').set(fay.auth).expect(200);
    expect(me.body.quota).toMatchObject({
      plan: 'free',
      remaining: 0,
      limit: 3,
    });
    expect(me.body.storeAccountToken).toBe(fay.userId);
    const paywall = await request(server())
      .post('/lessons')
      .set(fay.auth)
      .send({ scenarioId: 'pro-daily-01' })
      .expect(402);
    expect(paywall.body.code).toBe('free_lessons_used');
  });

  it('takes one answer at a time: a double tap never leaves two learner lines in a row', async () => {
    const gil = await registerDevice(app);
    const start = await request(server())
      .post('/lessons?audio=false')
      .set(gil.auth)
      .send({ scenarioId: 'pro-interview-01' })
      .expect(201);
    const id: string = start.body.lesson.id;
    const results = await Promise.all(
      [1, 2].map(() =>
        request(server())
          .post(`/lessons/${id}/turns?audio=false`)
          .set(gil.auth)
          .send({ text: 'I work as a developer at a bank.' }),
      ),
    );
    for (const r of results) {
      expect([200, 409]).toContain(r.status);
    }
    const detail = await request(server())
      .get(`/lessons/${id}`)
      .set(gil.auth)
      .expect(200);
    const speakers: string[] = detail.body.turns.map(
      (t: { speaker: string }) => t.speaker,
    );
    for (let i = 1; i < speakers.length; i += 1) {
      expect(speakers[i] === 'learner' && speakers[i - 1] === 'learner').toBe(
        false,
      );
    }
  });

  it('completes a lesson only when the resay says the same idea again', async () => {
    const hal = await registerDevice(app);
    const start = await request(server())
      .post('/lessons?audio=false')
      .set(hal.auth)
      .send({ scenarioId: 'pro-interview-01' })
      .expect(201);
    const id: string = start.body.lesson.id;
    await request(server())
      .post(`/lessons/${id}/turns?audio=false`)
      .set(hal.auth)
      .send({ text: 'I am working here since three years.' })
      .expect(200);
    await request(server())
      .post(`/lessons/${id}/finish`)
      .set(hal.auth)
      .expect(200);
    const unrelated = await request(server())
      .post(`/lessons/${id}/resay`)
      .set(hal.auth)
      .send({ text: 'ok ok ok' })
      .expect(422);
    expect(unrelated.body.code).toBe('resay_too_short');
    await request(server())
      .post(`/lessons/${id}/resay`)
      .set(hal.auth)
      .send({ text: 'I have worked here for three years now.' })
      .expect(200);
  });

  it('stops paid AI calls once the daily spend budget is used', async () => {
    const ivy = await registerDevice(app);
    const start = await request(server())
      .post('/lessons?audio=false')
      .set(ivy.auth)
      .send({ scenarioId: 'pro-meeting-01' })
      .expect(201);
    const id: string = start.body.lesson.id;
    await db
      .update(lessons)
      .set({ costMicroUsd: 2_000_000 })
      .where(eq(lessons.id, id)); // $2
    const blocked = await request(server())
      .post(`/lessons/${id}/turns?audio=false`)
      .set(ivy.auth)
      .send({ text: 'The project is on track.' })
      .expect(429);
    expect(blocked.body.code).toBe('daily_limit');
    await request(server())
      .post('/lessons')
      .set(ivy.auth)
      .send({ scenarioId: 'pro-daily-01' })
      .expect(429);
    // Other users are not affected: the budget is per user (and a much larger global one).
    const other = await registerDevice(app);
    await request(server())
      .post('/lessons?audio=false')
      .set(other.auth)
      .send({ scenarioId: 'pro-daily-01' })
      .expect(201);
  });

  it('does not get stuck when a lesson waiting for its resay lost its scenario', async () => {
    const jo = await registerDevice(app);
    const start = await request(server())
      .post('/lessons?audio=false')
      .set(jo.auth)
      .send({ scenarioId: 'pro-interview-01' })
      .expect(201);
    const id: string = start.body.lesson.id;
    await request(server())
      .post(`/lessons/${id}/turns?audio=false`)
      .set(jo.auth)
      .send({ text: 'I am working here since three years.' })
      .expect(200);
    await request(server())
      .post(`/lessons/${id}/finish`)
      .set(jo.auth)
      .expect(200);
    await db
      .update(lessons)
      .set({ scenarioId: 'removed-scenario' })
      .where(eq(lessons.id, id));
    await request(server())
      .post('/lessons?audio=false')
      .set(jo.auth)
      .send({ scenarioId: 'pro-meeting-01' })
      .expect(201);
    const [old] = await db.select().from(lessons).where(eq(lessons.id, id));
    expect(old.state).toBe('abandoned');
  });

  it('records reports of a correction and of a coach line', async () => {
    const [own] = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(
        and(eq(lessons.userId, ada.userId), eq(lessons.state, 'completed')),
      );
    const detail = await request(server())
      .get(`/lessons/${own.id}`)
      .set(ada.auth)
      .expect(200);
    const coachTurn = detail.body.turns.find(
      (t: { speaker: string }) => t.speaker === 'coach',
    );
    await request(server())
      .post('/reports')
      .set(ada.auth)
      .send({
        target: 'correction',
        lessonId: own.id,
        reason: 'wrong',
        note: 'The tense was right.',
      })
      .expect(201);
    await request(server())
      .post('/reports')
      .set(ada.auth)
      .send({
        target: 'coach_turn',
        lessonId: own.id,
        turnId: coachTurn.id,
        reason: 'inappropriate',
      })
      .expect(201);
    const [correction] = await db
      .select()
      .from(corrections)
      .where(eq(corrections.lessonId, own.id));
    expect(correction.reportedWrong).toBe(true);
  });
});
