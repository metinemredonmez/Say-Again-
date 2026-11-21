import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  and,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  or,
  sql,
  sum,
} from 'drizzle-orm';
import { ApiError } from '../common/api-error.js';
import type { Env } from '../config/env.js';
import type { Database, Executor } from '../database/database.js';
import {
  lessons,
  reviewItems,
  subscriptions,
  usageMonths,
} from '../database/schema.js';

// Quota (product rules): three free lessons, then a subscription with 20 lessons a month. A
// lesson counts when it is completed (after the resay), so starting one checks what is left.
// RES-01: AI spend is bounded by what was actually spent today, per user and in total, so
// lessons that are started and dropped cannot block anyone (a start without answers costs
// almost nothing and counts almost nothing).

export interface QuotaStatus {
  plan: 'free' | 'subscribed' | 'unlimited';
  /** Lessons left in this plan: free lessons in total, or this month's with a subscription. */
  remaining: number | null;
  limit: number | null;
  subscriptionEndsAt: Date | null;
  startsLeftToday: number;
}

export function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const usd = (micro: number) => micro / 1_000_000;

@Injectable()
export class QuotaService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async activeSubscription(userId: string, now = new Date()) {
    const [row] = await this.db
      .select({
        productId: subscriptions.productId,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          inArray(subscriptions.status, ['active', 'grace']),
          or(
            isNull(subscriptions.currentPeriodEnd),
            gt(subscriptions.currentPeriodEnd, now),
          ),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async status(userId: string, now = new Date()): Promise<QuotaStatus> {
    const dailyCap = this.config.get('DAILY_LESSON_STARTS', { infer: true });
    const [{ startsToday }] = await this.db
      .select({ startsToday: count() })
      .from(lessons)
      .where(
        and(
          eq(lessons.userId, userId),
          gte(lessons.startedAt, startOfUtcDay(now)),
        ),
      );
    const startsLeftToday = Math.max(0, dailyCap - startsToday);

    if (!this.config.get('PAYWALL_ENABLED', { infer: true })) {
      return {
        plan: 'unlimited',
        remaining: null,
        limit: null,
        subscriptionEndsAt: null,
        startsLeftToday,
      };
    }

    const subscription = await this.activeSubscription(userId, now);
    if (subscription) {
      // This month's lessons since the subscription started: free lessons done earlier in the
      // month do not use up the subscription.
      const monthStart = startOfUtcMonth(now);
      const since =
        subscription.createdAt > monthStart
          ? subscription.createdAt
          : monthStart;
      const limit = this.config.get('MONTHLY_LESSONS', { infer: true });
      const [{ done }] = await this.db
        .select({ done: count() })
        .from(lessons)
        .where(
          and(
            eq(lessons.userId, userId),
            eq(lessons.state, 'completed'),
            gte(lessons.completedAt, since),
          ),
        );
      return {
        plan: 'subscribed',
        remaining: Math.max(0, limit - done),
        limit,
        subscriptionEndsAt: subscription.currentPeriodEnd,
        startsLeftToday,
      };
    }

    const limit = this.config.get('FREE_LESSONS', { infer: true });
    const [{ done }] = await this.db
      .select({ done: count() })
      .from(lessons)
      .where(and(eq(lessons.userId, userId), eq(lessons.state, 'completed')));
    return {
      plan: 'free',
      remaining: Math.max(0, limit - done),
      limit,
      subscriptionEndsAt: null,
      startsLeftToday,
    };
  }

  /** Throws when the user may not start another lesson now. */
  async assertCanStart(userId: string, now = new Date()): Promise<QuotaStatus> {
    const status = await this.status(userId, now);
    if (status.remaining !== null && status.remaining <= 0) {
      throw new ApiError(
        HttpStatus.PAYMENT_REQUIRED,
        status.plan === 'free' ? 'free_lessons_used' : 'monthly_quota_used',
        status.plan === 'free'
          ? 'The free lessons are used up'
          : "This month's lessons are used up",
        { quota: status },
      );
    }
    if (status.startsLeftToday <= 0) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'daily_limit',
        'Daily lesson limit reached',
        { quota: status },
      );
    }
    await this.assertAiBudget(userId, now);
    return status;
  }

  /** Throws before a paid AI call when today's spend is over the user or global budget. */
  async assertAiBudget(userId: string, now = new Date()): Promise<void> {
    const [mine, everyone] = await Promise.all([
      this.spentToday(userId, now),
      this.spentToday(null, now),
    ]);
    if (
      usd(mine) >= this.config.get('DAILY_USER_AI_BUDGET_USD', { infer: true })
    ) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'daily_limit',
        'Daily practice limit reached; continue tomorrow',
      );
    }
    if (
      usd(everyone) >=
      this.config.get('GLOBAL_DAILY_AI_BUDGET_USD', { infer: true })
    ) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'service_busy',
        'Lessons are paused for today; try again tomorrow',
      );
    }
  }

  /** Micro-dollars spent today on lessons started today and on review answers. */
  private async spentToday(userId: string | null, now: Date): Promise<number> {
    const since = startOfUtcDay(now);
    const [[lessonSpend], [reviewSpend]] = await Promise.all([
      this.db
        .select({ total: sum(lessons.costMicroUsd) })
        .from(lessons)
        .where(
          and(
            gte(lessons.startedAt, since),
            userId ? eq(lessons.userId, userId) : undefined,
          ),
        ),
      this.db
        .select({ total: sum(reviewItems.costMicroUsd) })
        .from(reviewItems)
        .where(
          and(
            gte(reviewItems.doneAt, since),
            userId ? eq(reviewItems.userId, userId) : undefined,
          ),
        ),
    ]);
    return Number(lessonSpend?.total ?? 0) + Number(reviewSpend?.total ?? 0);
  }

  /** Counts a completed lesson for the month (statistics), inside the completing transaction. */
  async recordCompleted(
    tx: Executor,
    userId: string,
    now = new Date(),
  ): Promise<void> {
    await tx
      .insert(usageMonths)
      .values({ userId, month: monthKey(now), lessonsCompleted: 1 })
      .onConflictDoUpdate({
        target: [usageMonths.userId, usageMonths.month],
        set: { lessonsCompleted: sql`${usageMonths.lessonsCompleted} + 1` },
      });
  }
}
