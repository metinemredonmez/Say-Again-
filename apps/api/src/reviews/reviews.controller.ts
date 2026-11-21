import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  answerInput,
  audioUploadOptions,
  spokenTextSchema,
} from '../common/audio-upload.js';
import { OUTCOMES } from '../database/schema.js';
import type { AppUser } from '../users/users.repository.js';
import { ReviewsService } from './reviews.service.js';

const itemId = z.uuid();
const resultSchema = z.strictObject({ outcome: z.enum(OUTCOMES) });

@Controller()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('today')
  today(@CurrentUser() user: AppUser) {
    return this.reviews.today(user);
  }

  @Get('phrases')
  phrases(@CurrentUser() user: AppUser) {
    return this.reviews.phrases(user);
  }

  @Post('review-items/:id/hint')
  @HttpCode(200)
  hint(
    @CurrentUser() user: AppUser,
    @Param('id', { schema: itemId }) id: string,
  ) {
    return this.reviews.hint(user, id);
  }

  @Post('review-items/:id/answer')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('audio', audioUploadOptions))
  answer(
    @CurrentUser() user: AppUser,
    @Param('id', { schema: itemId }) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body({ schema: spokenTextSchema }) body: z.infer<typeof spokenTextSchema>,
  ) {
    return this.reviews.answerTransfer(user, id, answerInput(file, body.text));
  }

  @Post('review-items/:id/result')
  @HttpCode(200)
  result(
    @CurrentUser() user: AppUser,
    @Param('id', { schema: itemId }) id: string,
    @Body({ schema: resultSchema }) body: z.infer<typeof resultSchema>,
  ) {
    return this.reviews.recordReview(user, id, body.outcome);
  }
}
