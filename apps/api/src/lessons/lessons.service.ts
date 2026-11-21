import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import {
  AiOutputError,
  AiUnavailableError,
  COACH_MODEL,
  EVALUATOR_MODEL,
  SPEECH_TO_TEXT,
  TEXT_TO_SPEECH,
  type CoachModel,
  type CoachReply,
  type CoachStage,
  type CorrectionDraft,
  type Difficulty,
  type EvaluatorModel,
  type SpeechToText,
  type TextToSpeech,
  type TranscriptLine,
} from '../ai/ai.types.js';
import { checkCorrection, contentWords } from '../ai/correction-guard.js';
import { ApiError } from '../common/api-error.js';
import type { AnswerInput } from '../common/audio-upload.js';
import {
  isUniqueViolation,
  type Database,
  type Executor,
} from '../database/database.js';
import {
  corrections,
  lessons,
  phrases,
  reviewItems,
  turns,
  type Correction,
  type Lesson,
  type Turn,
} from '../database/schema.js';
import { QuotaService, type SpendSource } from '../quota/quota.service.js';
import { SecurityEvents } from '../security/security-events.js';
import type { Scenario } from '../scenarios/scenario-content.js';
import { ScenariosService } from '../scenarios/scenarios.service.js';
import type { AppUser } from '../users/users.repository.js';

// The lesson flow (docs/03-mimari.md), with the product rules enforced on the server:
// push-to-talk turns; the coach never corrects during the lesson and asks exactly one follow-up
// question; one correction at the end; the lesson is complete only after the resay; at most
// 10 minutes; reviews on days 1, 3 and 7 and a transfer task on day 3.
// Every query is scoped to the signed-in user (AZ-01). Every state change is a conditional
// update or runs under a row lock, so parallel requests cannot run a step twice (BUS-01/02).

export const LESSON_MINUTES = 10;
export const MAX_LEARNER_TURNS = 4;
export const REVIEW_DAYS = [1, 3, 7];
export const TRANSFER_DAY = 3;
// Longer than the slowest evaluation (2 attempts x 2 tries x 60 s), so a running evaluation is
// never taken over; a crashed one is recovered after it.
const EVALUATION_LEASE_MS = 6 * 60_000;
// A learner line without a coach reply this old belongs to a request that died.
const STALE_TURN_MS = 2 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export interface AudioClip {
  mimeType: string;
  base64: string;
}

interface UsageDelta {
  sttMs?: number;
  ttsChars?: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicroUsd?: number;
}

function lessonView(lesson: Lesson) {
  return {
    id: lesson.id,
    scenarioId: lesson.scenarioId,
    difficulty: lesson.difficulty,
    state: lesson.state === 'evaluating' ? 'in_progress' : lesson.state,
    startedAt: lesson.startedAt,
    endsAt: new Date(lesson.startedAt.getTime() + LESSON_MINUTES * 60_000),
    completedAt: lesson.completedAt,
  };
}

function correctionView(c: Correction) {
  return {
    id: c.id,
    kind: c.kind,
    original: c.original,
    improved: c.improved,
    explanationTr: c.explanationTr,
    category: c.category,
    resayPromptTr: c.resayPromptTr,
    resayText: c.resayText,
  };
}

function turnView(t: Turn) {
  return {
    id: t.id,
    position: t.position,
    speaker: t.speaker,
    move: t.coachMove,
    text: t.text,
  };
}

const wordCount = (text: string) =>
  text.trim().split(/\s+/).filter(Boolean).length;

@Injectable()
export class LessonsService {
  private readonly logger = new Logger(LessonsService.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly scenarios: ScenariosService,
    private readonly quota: QuotaService,
    @Inject(COACH_MODEL) private readonly coach: CoachModel,
    @Inject(EVALUATOR_MODEL) private readonly evaluator: EvaluatorModel,
    @Inject(SPEECH_TO_TEXT) private readonly stt: SpeechToText,
    @Inject(TEXT_TO_SPEECH) private readonly tts: TextToSpeech,
    private readonly events: SecurityEvents,
  ) {}

  // Start

  async start(
    user: AppUser,
    input: { scenarioId: string; difficulty?: Difficulty },
    withAudio: boolean,
  ) {
    const scenario = this.scenarios.findInternal(input.scenarioId);
    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }
    if (scenario.targetLanguage !== user.targetLanguage) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'scenario_language_mismatch',
        'Scenario is for another language',
      );
    }

    const [pending] = await this.db
      .select({ id: lessons.id, scenarioId: lessons.scenarioId })
      .from(lessons)
      .where(
        and(eq(lessons.userId, user.id), eq(lessons.state, 'awaiting_resay')),
      );
    if (pending && this.scenarios.findInternal(pending.scenarioId)) {
      // Product rule: a lesson is not done until the idea is said again.
      throw new ApiError(
        HttpStatus.CONFLICT,
        'resay_pending',
        'Finish the resay of your last lesson first',
        { lessonId: pending.id },
      );
    }

    const quota = await this.quota.assertCanStart(user.id);
    const difficulty = input.difficulty ?? user.difficulty;

    let lesson: Lesson;
    try {
      lesson = await this.db.transaction(async (tx) => {
        // A new lesson replaces an unfinished one, one whose evaluation was lost, and one whose
        // scenario was removed from the content (it could never be completed).
        await tx
          .update(lessons)
          .set({ state: 'abandoned' })
          .where(
            and(
              eq(lessons.userId, user.id),
              or(
                eq(lessons.state, 'in_progress'),
                and(
                  eq(lessons.state, 'evaluating'),
                  lt(lessons.evaluationStartedAt, this.leaseExpiry()),
                ),
                pending ? eq(lessons.id, pending.id) : undefined,
              ),
            ),
          );
        const [row] = await tx
          .insert(lessons)
          .values({ userId: user.id, scenarioId: scenario.id, difficulty })
          .returning();
        await tx.insert(turns).values({
          lessonId: row.id,
          position: 0,
          speaker: 'coach',
          coachMove: 'opening',
          text: scenario.opening,
        });
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'lesson_busy',
          'Another lesson is being evaluated; try again shortly',
        );
      }
      throw error;
    }

    const audio = withAudio
      ? await this.speak(lesson, scenario.opening, difficulty)
      : undefined;
    return {
      lesson: lessonView(lesson),
      coach: { text: scenario.opening, move: 'opening' as const, audio },
      // Easy mode shows sentence starters; hard mode has no hints (prompts/coach.md).
      hints: difficulty === 'easy' ? scenario.hints : [],
      quota,
    };
  }

  // Turns

  async addTurn(
    user: AppUser,
    lessonId: string,
    answer: AnswerInput,
    withAudio: boolean,
  ) {
    const { lesson, scenario } = await this.ownLesson(user, lessonId);
    this.assertTakesAnswers(lesson, await this.turnsOf(lesson.id));
    await this.quota.assertAiBudget(user.id);

    const started = Date.now();
    const text = await this.answerText(lesson, scenario, answer);

    // Under a lock on the lesson row: one answer at a time, and only after the coach replied to
    // the previous one (a double tap gets 409 instead of a broken transcript).
    const { history, position } = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(lessons)
        .where(eq(lessons.id, lesson.id))
        .for('update');
      let rows = await this.turnsOf(lesson.id, tx);
      const last = rows.at(-1);
      if (
        last?.speaker === 'learner' &&
        Date.now() - last.createdAt.getTime() > STALE_TURN_MS
      ) {
        await tx.delete(turns).where(eq(turns.id, last.id));
        rows = rows.slice(0, -1);
      }
      this.assertTakesAnswers(locked, rows);
      if (rows.at(-1)?.speaker === 'learner') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'turn_in_progress',
          'The coach is still answering the previous message',
        );
      }
      await tx.insert(turns).values({
        lessonId: lesson.id,
        position: rows.length,
        speaker: 'learner',
        text,
        fromAudio: 'audio' in answer,
      });
      return { history: rows, position: rows.length };
    });

    // The flow, not the model, decides what the coach's line is for: one follow-up question,
    // then close. A hint (when the learner is stuck) keeps the follow-up for the next turn.
    const learnerTurns = history.filter((t) => t.speaker === 'learner').length;
    const followUpAsked = history.some((t) => t.coachMove === 'follow_up');
    const stage: CoachStage =
      !followUpAsked && learnerTurns + 1 < MAX_LEARNER_TURNS
        ? 'ask_follow_up'
        : 'close';
    const transcript: TranscriptLine[] = [
      ...history.map((t) => ({ speaker: t.speaker, text: t.text })),
      { speaker: 'learner', text },
    ];

    let reply: CoachReply;
    try {
      reply = await this.coach.reply({
        scenario,
        difficulty: lesson.difficulty,
        transcript,
        stage,
      });
    } catch (error) {
      // Take the answer back so the learner can simply send it again.
      await this.db
        .delete(turns)
        .where(
          and(eq(turns.lessonId, lesson.id), eq(turns.position, position)),
        );
      throw this.aiError('coach', lesson.id, error);
    }

    await this.addUsage(this.db, lesson, 'coach', reply.usage);
    await this.db.insert(turns).values({
      lessonId: lesson.id,
      position: position + 1,
      speaker: 'coach',
      coachMove: reply.move,
      text: reply.text,
      latencyMs: Date.now() - started,
    });

    const audio = withAudio
      ? await this.speak(lesson, reply.text, lesson.difficulty)
      : undefined;
    return {
      learner: { text, fromAudio: 'audio' in answer },
      coach: { text: reply.text, move: reply.move, audio },
      closed: reply.move === 'closing',
    };
  }

  // Finish: the one correction

  async finish(user: AppUser, lessonId: string) {
    const { lesson, scenario } = await this.ownLesson(user, lessonId);
    if (lesson.state === 'awaiting_resay' || lesson.state === 'completed') {
      return this.finishResult(lesson); // idempotent: the same correction, no second AI call
    }
    if (lesson.state === 'abandoned') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'lesson_abandoned',
        'This lesson was replaced by a newer one',
      );
    }

    const history = await this.turnsOf(lesson.id);
    const learnerLines = history
      .filter((t) => t.speaker === 'learner')
      .map((t) => t.text);
    if (learnerLines.length === 0) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'no_answer_yet',
        'Answer at least once before finishing',
      );
    }
    await this.quota.assertAiBudget(user.id);

    // Claim the evaluation with a token (its start time): of two parallel finishes only one
    // calls the evaluator, and only the holder of the claim may write the result or release it.
    const claim = new Date();
    const claimed = await this.db
      .update(lessons)
      .set({ state: 'evaluating', evaluationStartedAt: claim })
      .where(
        and(
          eq(lessons.id, lesson.id),
          or(
            eq(lessons.state, 'in_progress'),
            and(
              eq(lessons.state, 'evaluating'),
              lt(lessons.evaluationStartedAt, this.leaseExpiry()),
            ),
          ),
        ),
      )
      .returning({ id: lessons.id });
    if (claimed.length === 0) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'lesson_busy',
        'The correction is being prepared; try again shortly',
      );
    }
    const holdsClaim = and(
      eq(lessons.id, lesson.id),
      eq(lessons.state, 'evaluating'),
      eq(lessons.evaluationStartedAt, claim),
    );

    let draft: CorrectionDraft;
    try {
      draft = await this.evaluate(lesson, scenario, history, learnerLines);
    } catch (error) {
      await this.db
        .update(lessons)
        .set({ state: 'in_progress', evaluationStartedAt: null })
        .where(holdsClaim);
      throw this.aiError('evaluator', lesson.id, error);
    }

    const written = await this.db.transaction(async (tx) => {
      const moved = await tx
        .update(lessons)
        .set({ state: 'awaiting_resay', evaluatedAt: new Date() })
        .where(holdsClaim)
        .returning({ id: lessons.id });
      if (moved.length === 0) {
        return false; // the claim was lost; whoever holds it writes the correction
      }
      await tx.insert(corrections).values({ lessonId: lesson.id, ...draft });
      return true;
    });
    if (!written) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'lesson_busy',
        'The correction is being prepared; try again shortly',
      );
    }
    const [updated] = await this.db
      .select()
      .from(lessons)
      .where(eq(lessons.id, lesson.id));
    return this.finishResult(updated);
  }

  // Resay: completes the lesson

  async resay(user: AppUser, lessonId: string, answer: AnswerInput) {
    const { lesson, scenario } = await this.ownLesson(user, lessonId);
    if (lesson.state === 'completed') {
      return this.completedResult(lesson);
    }
    if (lesson.state !== 'awaiting_resay') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'resay_not_expected',
        'Finish the lesson before the resay',
      );
    }
    if ('audio' in answer) {
      await this.quota.assertAiBudget(user.id);
    }
    const text = await this.answerText(lesson, scenario, answer);
    const [correction] = await this.db
      .select()
      .from(corrections)
      .where(eq(corrections.lessonId, lesson.id));
    // Product rule: the same idea, said again. At least three words and something in common
    // with the corrected sentence; the wording may differ.
    const target = new Set([
      ...contentWords(correction.improved),
      ...contentWords(correction.original),
    ]);
    if (
      wordCount(text) < 3 ||
      !contentWords(text).some((word) => target.has(word))
    ) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'resay_too_short',
        'Say the whole idea again',
      );
    }

    const now = new Date();
    const completed = await this.db.transaction(async (tx) => {
      const done = await tx
        .update(lessons)
        .set({ state: 'completed', completedAt: now })
        .where(
          and(eq(lessons.id, lesson.id), eq(lessons.state, 'awaiting_resay')),
        )
        .returning({ id: lessons.id });
      if (done.length === 0) {
        return false; // a parallel resay won
      }
      await tx
        .update(corrections)
        .set({ resayText: text })
        .where(eq(corrections.lessonId, lesson.id));
      const [phrase] = await tx
        .insert(phrases)
        .values({
          userId: user.id,
          lessonId: lesson.id,
          scenarioId: lesson.scenarioId,
          text: correction.improved,
        })
        .returning();
      await tx.insert(reviewItems).values([
        ...REVIEW_DAYS.map((days) => ({
          userId: user.id,
          phraseId: phrase.id,
          kind: 'review' as const,
          dueAt: new Date(now.getTime() + days * DAY_MS),
        })),
        {
          userId: user.id,
          phraseId: phrase.id,
          kind: 'transfer' as const,
          dueAt: new Date(now.getTime() + TRANSFER_DAY * DAY_MS),
        },
      ]);
      await this.quota.recordCompleted(tx, user.id, now);
      return true;
    });
    if (!completed) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'resay_not_expected',
        'The resay was already recorded',
      );
    }
    const [updated] = await this.db
      .select()
      .from(lessons)
      .where(eq(lessons.id, lesson.id));
    return this.completedResult(updated);
  }

  // Reads

  async get(user: AppUser, lessonId: string) {
    const { lesson } = await this.ownLesson(user, lessonId);
    const [history, [correction]] = await Promise.all([
      this.turnsOf(lesson.id),
      this.db
        .select()
        .from(corrections)
        .where(eq(corrections.lessonId, lesson.id)),
    ]);
    return {
      lesson: lessonView(lesson),
      turns: history.map(turnView),
      correction: correction ? correctionView(correction) : null,
    };
  }

  async list(user: AppUser) {
    const rows = await this.db
      .select()
      .from(lessons)
      .where(
        and(
          eq(lessons.userId, user.id),
          inArray(lessons.state, [
            'in_progress',
            'evaluating',
            'awaiting_resay',
            'completed',
          ]),
        ),
      )
      .orderBy(desc(lessons.startedAt))
      .limit(50);
    return { lessons: rows.map(lessonView) };
  }

  /** The lesson waiting for its resay, for the Today screen. */
  async pendingResay(userId: string) {
    const [row] = await this.db
      .select({ lesson: lessons, correction: corrections })
      .from(lessons)
      .innerJoin(corrections, eq(corrections.lessonId, lessons.id))
      .where(
        and(eq(lessons.userId, userId), eq(lessons.state, 'awaiting_resay')),
      );
    if (!row || !this.scenarios.findInternal(row.lesson.scenarioId)) {
      return null;
    }
    return {
      lesson: lessonView(row.lesson),
      correction: correctionView(row.correction),
    };
  }

  // Helpers

  private async ownLesson(
    user: AppUser,
    lessonId: string,
  ): Promise<{ lesson: Lesson; scenario: Scenario }> {
    const [lesson] = await this.db
      .select()
      .from(lessons)
      .where(and(eq(lessons.id, lessonId), eq(lessons.userId, user.id)));
    // Someone else's lesson answers like a missing one: no hint that the id exists.
    const scenario = lesson && this.scenarios.findInternal(lesson.scenarioId);
    if (!lesson || !scenario) {
      throw new NotFoundException('Lesson not found');
    }
    return { lesson, scenario };
  }

  private assertTakesAnswers(lesson: Lesson, history: Turn[]): void {
    if (lesson.state !== 'in_progress') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'lesson_not_in_progress',
        'This lesson takes no more answers',
      );
    }
    if (Date.now() > lesson.startedAt.getTime() + LESSON_MINUTES * 60_000) {
      // Product rule: a lesson is at most 10 minutes. The learner can still finish it.
      throw new ApiError(
        HttpStatus.CONFLICT,
        'lesson_time_over',
        'Time is up; finish the lesson',
      );
    }
    const learnerTurns = history.filter((t) => t.speaker === 'learner').length;
    if (
      history.at(-1)?.coachMove === 'closing' ||
      learnerTurns >= MAX_LEARNER_TURNS
    ) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'lesson_closed',
        'The scene is over; finish the lesson',
      );
    }
  }

  private turnsOf(
    lessonId: string,
    executor: Executor = this.db,
  ): Promise<Turn[]> {
    return executor
      .select()
      .from(turns)
      .where(eq(turns.lessonId, lessonId))
      .orderBy(asc(turns.position));
  }

  private leaseExpiry(): Date {
    return new Date(Date.now() - EVALUATION_LEASE_MS);
  }

  private async answerText(
    lesson: Lesson,
    scenario: Scenario,
    answer: AnswerInput,
  ): Promise<string> {
    if ('text' in answer) {
      return answer.text;
    }
    let transcription;
    try {
      transcription = await this.stt.transcribe(answer.audio, { scenario });
    } catch (error) {
      throw this.aiError('speech-to-text', lesson.id, error);
    }
    await this.addUsage(this.db, lesson, 'speech_to_text', {
      sttMs: transcription.durationMs,
      costMicroUsd: transcription.costMicroUsd,
    });
    const text = transcription.text.trim().slice(0, 1000);
    if (!text) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'nothing_heard',
        'Nothing was heard; record again',
      );
    }
    return text;
  }

  private async evaluate(
    lesson: Lesson,
    scenario: Scenario,
    history: Turn[],
    learnerLines: string[],
  ) {
    const transcript = history.map((t) => ({
      speaker: t.speaker,
      text: t.text,
    }));
    let problems: string[] | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { draft, usage } = await this.evaluator.evaluate({
        scenario,
        transcript,
        problems,
      });
      await this.addUsage(this.db, lesson, 'evaluator', usage);
      problems = checkCorrection(draft, learnerLines);
      if (problems.length === 0) {
        return draft;
      }
      this.logger.warn(
        `Correction for lesson ${lesson.id} failed checks (attempt ${attempt + 1}): ${problems.length} problem(s)`,
      );
    }
    throw new AiOutputError('Correction failed the server checks twice');
  }

  private async speak(
    lesson: Lesson,
    text: string,
    difficulty: Difficulty,
  ): Promise<AudioClip | undefined> {
    try {
      const spoken = await this.tts.synthesize(text, { difficulty });
      await this.addUsage(this.db, lesson, 'text_to_speech', {
        ttsChars: spoken.chars,
        costMicroUsd: spoken.costMicroUsd,
      });
      return {
        mimeType: spoken.mimeType,
        base64: spoken.data.toString('base64'),
      };
    } catch (error) {
      // Audio is a nice-to-have: the text still works, so the turn does not fail.
      this.logger.warn(
        `Text to speech failed for lesson ${lesson.id}: ${(error as Error).name}`,
      );
      return undefined;
    }
  }

  /** The lesson's usage totals, and the spend row the daily budgets read (RES-01). */
  private async addUsage(
    tx: Executor,
    lesson: Lesson,
    source: SpendSource,
    delta: UsageDelta,
  ): Promise<void> {
    await this.quota.recordSpend(
      tx,
      lesson.userId,
      source,
      delta.costMicroUsd ?? 0,
    );
    await tx
      .update(lessons)
      .set({
        sttMs: sql`${lessons.sttMs} + ${delta.sttMs ?? 0}`,
        ttsChars: sql`${lessons.ttsChars} + ${delta.ttsChars ?? 0}`,
        inputTokens: sql`${lessons.inputTokens} + ${delta.inputTokens ?? 0}`,
        outputTokens: sql`${lessons.outputTokens} + ${delta.outputTokens ?? 0}`,
        costMicroUsd: sql`${lessons.costMicroUsd} + ${delta.costMicroUsd ?? 0}`,
      })
      .where(eq(lessons.id, lesson.id));
  }

  private aiError(step: string, lessonId: string, error: unknown): Error {
    // LOG-02: the lesson id and the error type, and the message only for the AI errors, whose
    // messages this code writes. Transcripts never go to the logs.
    const known =
      error instanceof AiUnavailableError || error instanceof AiOutputError;
    this.logger.error(
      `AI ${step} failed for lesson ${lessonId}: ${(error as Error).name}${known ? `: ${(error as Error).message}` : ''}`,
    );
    if (error instanceof AiOutputError) {
      // A refusal, unusable output, or a correction the server checks threw out (AI-02).
      this.events.record({
        event: 'ai.output_rejected',
        outcome: 'deny',
        object: lessonId,
        reason: `${step}: ${error.message}`,
      });
    }
    if (error instanceof AiUnavailableError) {
      return new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ai_unavailable',
        'The coach is not available right now; try again',
      );
    }
    if (error instanceof AiOutputError) {
      return new ApiError(
        HttpStatus.BAD_GATEWAY,
        'ai_failed',
        'The coach could not answer; try again',
      );
    }
    return error as Error;
  }

  private async finishResult(lesson: Lesson) {
    const [correction] = await this.db
      .select()
      .from(corrections)
      .where(eq(corrections.lessonId, lesson.id));
    return {
      lesson: lessonView(lesson),
      correction: correctionView(correction),
    };
  }

  private async completedResult(lesson: Lesson) {
    const [phrase] = await this.db
      .select()
      .from(phrases)
      .where(eq(phrases.lessonId, lesson.id));
    const reviews = await this.db
      .select({
        id: reviewItems.id,
        kind: reviewItems.kind,
        dueAt: reviewItems.dueAt,
      })
      .from(reviewItems)
      .where(eq(reviewItems.phraseId, phrase.id))
      .orderBy(asc(reviewItems.dueAt));
    return {
      lesson: lessonView(lesson),
      phrase: { id: phrase.id, text: phrase.text },
      reviews,
    };
  }
}
