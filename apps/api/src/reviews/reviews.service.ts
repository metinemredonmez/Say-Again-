import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, desc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import {
  AiOutputError,
  AiUnavailableError,
  EVALUATOR_MODEL,
  SPEECH_TO_TEXT,
  type EvaluatorModel,
  type SpeechToText,
} from '../ai/ai.types.js';
import { ApiError } from '../common/api-error.js';
import type { AnswerInput } from '../common/audio-upload.js';
import type { Database } from '../database/database.js';
import {
  lessons,
  OUTCOMES,
  phrases,
  reviewItems,
  type ReviewItem,
} from '../database/schema.js';
import { LessonsService } from '../lessons/lessons.service.js';
import { QuotaService } from '../quota/quota.service.js';
import { SecurityEvents } from '../security/security-events.js';
import { ScenariosService } from '../scenarios/scenarios.service.js';
import type { AppUser } from '../users/users.repository.js';

// Today screen, review queue and the transfer task. Product rules: the pending transfer comes
// first; the transfer task shows a different, hand-written question and never the earlier answer
// or the phrase; its result is unaided, hinted or failed; a failed item comes back the next day.

export type Outcome = (typeof OUTCOMES)[number];

/** At least four words, mostly Latin letters: not empty, not mostly Turkish-only filler. */
export function looksLikeAnAnswer(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const letters = text.replace(/[^\p{L}]/gu, '');
  const latin = letters.replace(/[^a-zA-Z]/g, '');
  return (
    words.length >= 4 &&
    letters.length > 0 &&
    latin.length / letters.length >= 0.9
  );
}
const DAY_MS = 24 * 60 * 60_000;

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly scenarios: ScenariosService,
    private readonly lessons: LessonsService,
    private readonly quota: QuotaService,
    @Inject(EVALUATOR_MODEL) private readonly evaluator: EvaluatorModel,
    @Inject(SPEECH_TO_TEXT) private readonly stt: SpeechToText,
    private readonly events: SecurityEvents,
  ) {}

  async today(user: AppUser, now = new Date()) {
    const due = await this.db
      .select({ item: reviewItems, phrase: phrases })
      .from(reviewItems)
      .innerJoin(phrases, eq(phrases.id, reviewItems.phraseId))
      .where(
        and(
          eq(reviewItems.userId, user.id),
          isNull(reviewItems.doneAt),
          lte(reviewItems.dueAt, now),
        ),
      )
      .orderBy(asc(reviewItems.dueAt))
      .limit(50);

    // A phrase's reviews wait until its transfer task is answered: showing the phrase first
    // would give the transfer answer away (the day-3 review and the transfer fall due together).
    const openTransfers = await this.db
      .select({ phraseId: reviewItems.phraseId })
      .from(reviewItems)
      .where(
        and(
          eq(reviewItems.userId, user.id),
          eq(reviewItems.kind, 'transfer'),
          isNull(reviewItems.doneAt),
        ),
      );
    const waitingForTransfer = new Set(openTransfers.map((t) => t.phraseId));

    const transfers = [];
    const reviews = [];
    for (const { item, phrase } of due) {
      const scenario = this.scenarios.findInternal(phrase.scenarioId);
      if (!scenario) {
        continue;
      }
      if (item.kind === 'transfer') {
        transfers.push({
          id: item.id,
          kind: 'transfer' as const,
          scenarioId: scenario.id,
          titleTr: scenario.titleTr,
          situationTr: scenario.transfer.situationTr,
          question: scenario.transfer.question,
          hintUsed: item.hintUsed,
          dueAt: item.dueAt,
        });
      } else if (!waitingForTransfer.has(item.phraseId)) {
        reviews.push({
          id: item.id,
          kind: 'review' as const,
          scenarioId: scenario.id,
          titleTr: scenario.titleTr,
          phrase: phrase.text,
          dueAt: item.dueAt,
        });
      }
    }

    const [pendingResay, quota, next] = await Promise.all([
      this.lessons.pendingResay(user.id),
      this.quota.status(user.id, now),
      this.nextScenario(user),
    ]);
    // One primary action: a waiting resay, then the transfer task, then reviews, then a new lesson.
    const primary = pendingResay
      ? 'resay'
      : transfers.length > 0
        ? 'transfer'
        : reviews.length > 0
          ? 'review'
          : 'lesson';
    return { primary, pendingResay, transfers, reviews, next, quota };
  }

  async phrases(user: AppUser) {
    const rows = await this.db
      .select({
        id: phrases.id,
        text: phrases.text,
        scenarioId: phrases.scenarioId,
        createdAt: phrases.createdAt,
      })
      .from(phrases)
      .where(eq(phrases.userId, user.id))
      .orderBy(desc(phrases.createdAt))
      .limit(200);
    return {
      phrases: rows.map((p) => ({
        ...p,
        titleTr: this.scenarios.findInternal(p.scenarioId)?.titleTr ?? null,
      })),
    };
  }

  /** The transfer task's sentence starters; using them makes the best result "hinted". */
  async hint(user: AppUser, itemId: string) {
    const { item, scenario } = await this.dueItem(user, itemId, 'transfer');
    await this.db
      .update(reviewItems)
      .set({ hintUsed: true })
      .where(and(eq(reviewItems.id, item.id), isNull(reviewItems.doneAt)));
    return { hints: scenario.hints };
  }

  /** The transfer answer, judged against the scenario's written success criterion. */
  async answerTransfer(user: AppUser, itemId: string, answer: AnswerInput) {
    const { item, scenario, phrase } = await this.dueItem(
      user,
      itemId,
      'transfer',
    );
    await this.quota.assertAiBudget(user.id);
    let text: string;
    let costMicroUsd = 0;
    try {
      if ('text' in answer) {
        text = answer.text;
      } else {
        const transcription = await this.stt.transcribe(answer.audio, {
          scenario,
        });
        // RES-01: written now, so parallel or failed answers are still counted.
        await this.quota.recordSpend(
          this.db,
          user.id,
          'speech_to_text',
          transcription.costMicroUsd,
        );
        text = transcription.text.trim();
        costMicroUsd += transcription.costMicroUsd;
      }
    } catch (error) {
      throw this.aiError('speech-to-text', item.id, error);
    }
    if (!text) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'nothing_heard',
        'Nothing was heard; record again',
      );
    }

    let judgement;
    try {
      judgement = await this.evaluator.judgeTransfer({
        scenario,
        answer: text.slice(0, 1000),
      });
    } catch (error) {
      throw this.aiError('transfer judge', item.id, error);
    }
    await this.quota.recordSpend(
      this.db,
      user.id,
      'transfer_judge',
      judgement.usage.costMicroUsd,
    );
    costMicroUsd += judgement.usage.costMicroUsd;
    // A floor the model cannot talk its way past: a real English answer of a few words.
    const passed = judgement.passed && looksLikeAnAnswer(text);
    const outcome: Outcome = !passed
      ? 'failed'
      : item.hintUsed
        ? 'hinted'
        : 'unaided';
    await this.complete(user, item, outcome, text.slice(0, 1000), costMicroUsd);
    // After the attempt the phrase may be shown again.
    return {
      outcome,
      feedbackTr: judgement.feedbackTr,
      answer: text,
      phrase: phrase.text,
    };
  }

  /** A day 1/3/7 review: the learner says the phrase and marks how it went. */
  async recordReview(user: AppUser, itemId: string, outcome: Outcome) {
    const { item } = await this.dueItem(user, itemId, 'review');
    const [openTransfer] = await this.db
      .select({ id: reviewItems.id })
      .from(reviewItems)
      .where(
        and(
          eq(reviewItems.phraseId, item.phraseId),
          eq(reviewItems.kind, 'transfer'),
          isNull(reviewItems.doneAt),
        ),
      );
    if (openTransfer) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'transfer_first',
        'Answer the transfer question first',
      );
    }
    await this.complete(user, item, outcome, null, 0);
    return { outcome };
  }

  private async complete(
    user: AppUser,
    item: ReviewItem,
    outcome: Outcome,
    answerText: string | null,
    costMicroUsd: number,
  ) {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const done = await tx
        .update(reviewItems)
        .set({ doneAt: now, outcome, answerText, costMicroUsd })
        .where(
          and(
            eq(reviewItems.id, item.id),
            eq(reviewItems.userId, user.id),
            isNull(reviewItems.doneAt),
          ),
        )
        .returning({ id: reviewItems.id });
      if (done.length === 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'already_done',
          'This item was already answered',
        );
      }
      if (outcome === 'failed') {
        // Product rule: a failed item comes back the next day as a review.
        await tx.insert(reviewItems).values({
          userId: user.id,
          phraseId: item.phraseId,
          kind: 'review',
          dueAt: new Date(now.getTime() + DAY_MS),
        });
      }
    });
  }

  private async dueItem(
    user: AppUser,
    itemId: string,
    kind: ReviewItem['kind'],
  ) {
    const [row] = await this.db
      .select({ item: reviewItems, phrase: phrases })
      .from(reviewItems)
      .innerJoin(phrases, eq(phrases.id, reviewItems.phraseId))
      .where(
        and(
          eq(reviewItems.id, itemId),
          eq(reviewItems.userId, user.id),
          eq(reviewItems.kind, kind),
        ),
      );
    const scenario = row && this.scenarios.findInternal(row.phrase.scenarioId);
    if (!row || !scenario) {
      throw new NotFoundException('Item not found');
    }
    if (row.item.doneAt) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'already_done',
        'This item was already answered',
      );
    }
    if (row.item.dueAt > new Date()) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'not_due',
        'This item is not due yet',
        { dueAt: row.item.dueAt },
      );
    }
    return { item: row.item, phrase: row.phrase, scenario };
  }

  private async nextScenario(user: AppUser) {
    const done = await this.db
      .select({ scenarioId: lessons.scenarioId })
      .from(lessons)
      .where(and(eq(lessons.userId, user.id), isNotNull(lessons.completedAt)));
    const practiced = new Set(done.map((d) => d.scenarioId));
    const pack = this.scenarios
      .list(user.pack)
      .filter((s) => s.targetLanguage === user.targetLanguage);
    return pack.find((s) => !practiced.has(s.id)) ?? pack[0] ?? null;
  }

  private aiError(step: string, itemId: string, error: unknown): Error {
    this.logger.error(
      `AI ${step} failed for review item ${itemId}: ${(error as Error).name}`,
    );
    if (error instanceof AiOutputError) {
      this.events.record({
        event: 'ai.output_rejected',
        outcome: 'deny',
        object: itemId,
        reason: `${step}: ${error.message}`,
      });
    }
    if (error instanceof AiUnavailableError) {
      return new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ai_unavailable',
        'Not available right now; try again',
      );
    }
    if (error instanceof AiOutputError) {
      return new ApiError(
        HttpStatus.BAD_GATEWAY,
        'ai_failed',
        'The answer could not be checked; try again',
      );
    }
    return error as Error;
  }
}
