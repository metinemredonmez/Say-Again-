import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// The database schema. drizzle-kit generates the migrations in apps/api/drizzle from this file.
// Audio is never stored: only text transcripts (docs/06-yayin-ve-hukuk.md). Deleting a user
// deletes everything below it (cascade), and refresh tokens explicitly.
//
// AZ-02: a second barrier under the queries. A row that names both a user and a parent row
// references the parent through (id, user_id), so the database itself refuses to attach one
// user's row to another user's lesson, phrase or turn.

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

export const LEVELS = ['A2', 'B1', 'B2', 'C1'] as const;
export const PACKS = ['professional', 'seller'] as const;
export const DIFFICULTIES = ['easy', 'hard'] as const;
export const LESSON_STATES = [
  'in_progress',
  'evaluating',
  'awaiting_resay',
  'completed',
  'abandoned',
] as const;
export const SPEAKERS = ['coach', 'learner'] as const;
export const COACH_MOVES = ['opening', 'follow_up', 'hint', 'closing'] as const;
export const CORRECTION_KINDS = ['correction', 'polish'] as const;
export const CATEGORIES = [
  'article',
  'preposition',
  'word-order',
  'tense',
  'plural-countable',
  'agreement',
  'word-choice',
  'politeness',
  'other',
] as const;
export const REVIEW_KINDS = ['review', 'transfer'] as const;
export const OUTCOMES = ['unaided', 'hinted', 'failed'] as const;
export const STORES = ['app_store', 'play_store'] as const;
export const SUBSCRIPTION_STATUSES = [
  'active',
  'grace',
  'expired',
  'refunded',
  'revoked',
] as const;
export const REPORT_TARGETS = ['correction', 'coach_turn'] as const;
export const REPORT_REASONS = ['wrong', 'inappropriate', 'other'] as const;

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

// Anonymous user: created by POST /auth/device, signed in with tokens only.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    level: text('level', { enum: LEVELS }),
    pack: text('pack', { enum: PACKS }).notNull().default('professional'),
    difficulty: text('difficulty', { enum: DIFFICULTIES })
      .notNull()
      .default('easy'),
    // ISO 639-1 code of the language being learned; matches scenarios' targetLanguage.
    targetLanguage: text('target_language').notNull().default('en'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'users_level_check',
      sql`${t.level} is null or ${inList('level', LEVELS)}`,
    ),
    check('users_pack_check', inList('pack', PACKS)),
    check('users_difficulty_check', inList('difficulty', DIFFICULTIES)),
    check(
      'users_target_language_check',
      sql`${t.targetLanguage} ~ '^[a-z]{2}$'`,
    ),
  ],
);

// Refresh tokens for @nestjs/authentication, stored by SHA-256 (see auth/refresh-token.store.ts).
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    familyExpiresAt: at('family_expires_at').notNull(),
    usedAt: at('used_at'),
    revoked: boolean('revoked').notNull().default(false),
    claims: jsonb('claims').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('refresh_tokens_family_id_idx').on(t.familyId),
    index('refresh_tokens_user_id_idx').on(t.userId),
    index('refresh_tokens_family_expires_at_idx').on(t.familyExpiresAt),
  ],
);

// One rehearsal. States: in_progress -> evaluating -> awaiting_resay -> completed (or abandoned).
export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scenarioId: text('scenario_id').notNull(),
    difficulty: text('difficulty', { enum: DIFFICULTIES }).notNull(),
    state: text('state', { enum: LESSON_STATES })
      .notNull()
      .default('in_progress'),
    startedAt: at('started_at').notNull().defaultNow(),
    // Set when evaluation starts; a crash mid-evaluation is recovered after a timeout.
    evaluationStartedAt: at('evaluation_started_at'),
    evaluatedAt: at('evaluated_at'),
    completedAt: at('completed_at'),
    // Quality test 10: cost per lesson.
    sttMs: integer('stt_ms').notNull().default(0),
    ttsChars: integer('tts_chars').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' })
      .notNull()
      .default(0),
  },
  (t) => [
    index('lessons_user_started_idx').on(t.userId, t.startedAt.desc()),
    index('lessons_started_idx').on(t.startedAt),
    // At most one open lesson per user; the database enforces it under concurrency (BUS-02).
    uniqueIndex('lessons_one_open_per_user')
      .on(t.userId)
      .where(
        sql`${t.state} in ('in_progress', 'evaluating', 'awaiting_resay')`,
      ),
    check('lessons_state_check', inList('state', LESSON_STATES)),
    check('lessons_difficulty_check', inList('difficulty', DIFFICULTIES)),
    unique('lessons_id_user_unique').on(t.id, t.userId),
  ],
);

// Coach and learner lines, as text.
export const turns = pgTable(
  'turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    speaker: text('speaker', { enum: SPEAKERS }).notNull(),
    coachMove: text('coach_move', { enum: COACH_MOVES }),
    text: text('text').notNull(),
    fromAudio: boolean('from_audio').notNull().default(false),
    latencyMs: integer('latency_ms'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('turns_lesson_position_unique').on(t.lessonId, t.position),
    unique('turns_id_lesson_unique').on(t.id, t.lessonId),
    check('turns_speaker_check', inList('speaker', SPEAKERS)),
    check(
      'turns_coach_move_check',
      sql`${t.coachMove} is null or ${inList('coach_move', COACH_MOVES)}`,
    ),
  ],
);

// One correction per lesson.
export const corrections = pgTable(
  'corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .unique()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: CORRECTION_KINDS }).notNull(),
    original: text('original').notNull(),
    improved: text('improved').notNull(),
    explanationTr: text('explanation_tr').notNull(),
    category: text('category', { enum: CATEGORIES }).notNull(),
    resayPromptTr: text('resay_prompt_tr').notNull(),
    resayText: text('resay_text'),
    reportedWrong: boolean('reported_wrong').notNull().default(false),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  () => [
    check('corrections_kind_check', inList('kind', CORRECTION_KINDS)),
    check('corrections_category_check', inList('category', CATEGORIES)),
  ],
);

// The personal phrase a lesson leaves behind (the notebook).
export const phrases = pgTable(
  'phrases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .unique()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    scenarioId: text('scenario_id').notNull(),
    text: text('text').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('phrases_user_idx').on(t.userId, t.createdAt.desc()),
    unique('phrases_id_user_unique').on(t.id, t.userId),
    foreignKey({
      name: 'phrases_lesson_same_user_fkey',
      columns: [t.lessonId, t.userId],
      foreignColumns: [lessons.id, lessons.userId],
    }).onDelete('cascade'),
  ],
);

// Review queue (days 1, 3, 7) and the transfer task (day 3).
export const reviewItems = pgTable(
  'review_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    phraseId: uuid('phrase_id')
      .notNull()
      .references(() => phrases.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: REVIEW_KINDS }).notNull(),
    dueAt: at('due_at').notNull(),
    hintUsed: boolean('hint_used').notNull().default(false),
    answerText: text('answer_text'),
    // AI cost of judging the answer (speech-to-text and the judge), for the daily budget.
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' })
      .notNull()
      .default(0),
    doneAt: at('done_at'),
    outcome: text('outcome', { enum: OUTCOMES }),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('review_items_due_idx')
      .on(t.userId, t.dueAt)
      .where(sql`${t.doneAt} is null`),
    foreignKey({
      name: 'review_items_phrase_same_user_fkey',
      columns: [t.phraseId, t.userId],
      foreignColumns: [phrases.id, phrases.userId],
    }).onDelete('cascade'),
    check('review_items_kind_check', inList('kind', REVIEW_KINDS)),
    check(
      'review_items_outcome_check',
      sql`${t.outcome} is null or ${inList('outcome', OUTCOMES)}`,
    ),
  ],
);

// Monthly lesson counter (quota). month: first day of the month, UTC.
export const usageMonths = pgTable(
  'usage_months',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    month: date('month', { mode: 'string' }).notNull(),
    lessonsCompleted: integer('lessons_completed').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.month] })],
);

// Store subscription state, verified with Apple or Google. storeRef is Apple's
// originalTransactionId or Google's purchase token; one purchase belongs to one user.
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    store: text('store', { enum: STORES }).notNull(),
    storeRef: text('store_ref').notNull(),
    productId: text('product_id').notNull(),
    status: text('status', { enum: SUBSCRIPTION_STATUSES }).notNull(),
    currentPeriodEnd: at('current_period_end'),
    sandbox: boolean('sandbox').notNull().default(false),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('subscriptions_store_ref_unique').on(t.store, t.storeRef),
    index('subscriptions_user_idx').on(t.userId),
    check('subscriptions_store_check', inList('store', STORES)),
    check(
      'subscriptions_status_check',
      inList('status', SUBSCRIPTION_STATUSES),
    ),
  ],
);

// "This correction is wrong" and "report this AI answer" (store requirement).
export const aiReports = pgTable(
  'ai_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    target: text('target', { enum: REPORT_TARGETS }).notNull(),
    turnId: uuid('turn_id').references(() => turns.id, { onDelete: 'cascade' }),
    reason: text('reason', { enum: REPORT_REASONS }).notNull(),
    note: text('note'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('ai_reports_created_idx').on(t.createdAt),
    foreignKey({
      name: 'ai_reports_lesson_same_user_fkey',
      columns: [t.lessonId, t.userId],
      foreignColumns: [lessons.id, lessons.userId],
    }).onDelete('cascade'),
    // A reported coach line belongs to the reported lesson (no check when turn_id is null).
    foreignKey({
      name: 'ai_reports_turn_same_lesson_fkey',
      columns: [t.turnId, t.lessonId],
      foreignColumns: [turns.id, turns.lessonId],
    }).onDelete('cascade'),
    check('ai_reports_target_check', inList('target', REPORT_TARGETS)),
    check('ai_reports_reason_check', inList('reason', REPORT_REASONS)),
  ],
);

export const SPEND_SOURCES = [
  'speech_to_text',
  'coach',
  'evaluator',
  'transfer_judge',
  'text_to_speech',
] as const;

// RES-01: every paid AI call, written right after the call, whatever happens to the request
// afterwards. The daily budgets read this table. Deleting an account keeps the rows with no user
// (cost and time only), so deleting accounts cannot reset the global budget.
export const aiSpend = pgTable(
  'ai_spend',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    source: text('source', { enum: SPEND_SOURCES }).notNull(),
    costMicroUsd: integer('cost_micro_usd').notNull(),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [
    index('ai_spend_at_idx').on(t.at),
    index('ai_spend_user_at_idx').on(t.userId, t.at),
    check('ai_spend_source_check', inList('source', SPEND_SOURCES)),
    check('ai_spend_cost_check', sql`${t.costMicroUsd} >= 0`),
  ],
);

export type User = typeof users.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type Turn = typeof turns.$inferSelect;
export type Correction = typeof corrections.$inferSelect;
export type Phrase = typeof phrases.$inferSelect;
export type ReviewItem = typeof reviewItems.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
