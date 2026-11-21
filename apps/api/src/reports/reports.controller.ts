import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Throttle } from '@nestjs/throttler';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError } from '../common/api-error.js';
import type { Database } from '../database/database.js';
import {
  aiReports,
  corrections,
  lessons,
  REPORT_REASONS,
  turns,
} from '../database/schema.js';
import type { AppUser } from '../users/users.repository.js';

// "This correction is wrong" (MVP screen 4) and reporting any AI answer without leaving the app
// (App Store and Google Play requirement). Reported corrections feed the eval answer keys
// (docs/05-ai-kalite-testleri.md); the admin panel will list them.

const reportSchema = z.discriminatedUnion('target', [
  z.strictObject({
    target: z.literal('correction'),
    lessonId: z.uuid(),
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(500).optional(),
  }),
  z.strictObject({
    target: z.literal('coach_turn'),
    lessonId: z.uuid(),
    turnId: z.uuid(),
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(500).optional(),
  }),
]);

@Controller('reports')
export class ReportsController {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async create(
    @CurrentUser() user: AppUser,
    @Body({ schema: reportSchema }) body: z.infer<typeof reportSchema>,
  ) {
    const [lesson] = await this.db
      .select({ id: lessons.id })
      .from(lessons)
      .where(and(eq(lessons.id, body.lessonId), eq(lessons.userId, user.id)));
    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }

    let turnId: string | null = null;
    if (body.target === 'coach_turn') {
      const [turn] = await this.db
        .select({ id: turns.id })
        .from(turns)
        .where(
          and(
            eq(turns.id, body.turnId),
            eq(turns.lessonId, lesson.id),
            eq(turns.speaker, 'coach'),
          ),
        );
      if (!turn) {
        throw new NotFoundException('Turn not found');
      }
      turnId = turn.id;
    } else {
      const marked = await this.db
        .update(corrections)
        .set({ reportedWrong: true })
        .where(eq(corrections.lessonId, lesson.id))
        .returning({ id: corrections.id });
      if (marked.length === 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'no_correction',
          'This lesson has no correction yet',
        );
      }
    }

    const [report] = await this.db
      .insert(aiReports)
      .values({
        userId: user.id,
        lessonId: lesson.id,
        target: body.target,
        turnId,
        reason: body.reason,
        note: body.note,
      })
      .returning({ id: aiReports.id, createdAt: aiReports.createdAt });
    return report;
  }
}
