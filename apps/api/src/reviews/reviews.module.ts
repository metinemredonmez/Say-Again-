import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { LessonsModule } from '../lessons/lessons.module.js';
import { QuotaModule } from '../quota/quota.module.js';
import { ScenariosModule } from '../scenarios/scenarios.module.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

@Module({
  imports: [AiModule, LessonsModule, QuotaModule, ScenariosModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
