import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
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
import { DIFFICULTIES } from '../database/schema.js';
import { scenarioIdSchema } from '../scenarios/scenario-content.js';
import type { AppUser } from '../users/users.repository.js';
import { LessonsService } from './lessons.service.js';

const lessonId = z.uuid();
const startSchema = z.strictObject({
  scenarioId: scenarioIdSchema,
  difficulty: z.enum(DIFFICULTIES).optional(),
});
// ?audio=false skips speech synthesis (text-only clients, tests).
const audioQuery = z.object({
  audio: z.enum(['true', 'false']).default('true'),
});

@Controller('lessons')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class LessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Get()
  list(@CurrentUser() user: AppUser) {
    return this.lessons.list(user);
  }

  @Post()
  start(
    @CurrentUser() user: AppUser,
    @Body({ schema: startSchema }) body: z.infer<typeof startSchema>,
    @Query({ schema: audioQuery }) query: z.infer<typeof audioQuery>,
  ) {
    return this.lessons.start(user, body, query.audio === 'true');
  }

  @Get(':id')
  get(
    @CurrentUser() user: AppUser,
    @Param('id', { schema: lessonId }) id: string,
  ) {
    return this.lessons.get(user, id);
  }

  // multipart/form-data with an "audio" file, or JSON {"text": "..."}.
  @Post(':id/turns')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('audio', audioUploadOptions))
  addTurn(
    @CurrentUser() user: AppUser,
    @Param('id', { schema: lessonId }) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body({ schema: spokenTextSchema }) body: z.infer<typeof spokenTextSchema>,
    @Query({ schema: audioQuery }) query: z.infer<typeof audioQuery>,
  ) {
    return this.lessons.addTurn(
      user,
      id,
      answerInput(file, body.text),
      query.audio === 'true',
    );
  }

  @Post(':id/finish')
  @HttpCode(200)
  finish(
    @CurrentUser() user: AppUser,
    @Param('id', { schema: lessonId }) id: string,
  ) {
    return this.lessons.finish(user, id);
  }

  @Post(':id/resay')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('audio', audioUploadOptions))
  resay(
    @CurrentUser() user: AppUser,
    @Param('id', { schema: lessonId }) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body({ schema: spokenTextSchema }) body: z.infer<typeof spokenTextSchema>,
  ) {
    return this.lessons.resay(user, id, answerInput(file, body.text));
  }
}
