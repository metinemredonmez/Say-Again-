import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { QuotaModule } from '../quota/quota.module.js';
import { ScenariosModule } from '../scenarios/scenarios.module.js';
import { LessonsController } from './lessons.controller.js';
import { LessonsService } from './lessons.service.js';

@Module({
  imports: [AiModule, QuotaModule, ScenariosModule],
  controllers: [LessonsController],
  providers: [LessonsService],
  exports: [LessonsService],
})
export class LessonsModule {}
