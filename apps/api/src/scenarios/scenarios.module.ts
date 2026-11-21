import { Module } from '@nestjs/common';
import {
  loadScenarioContent,
  scenarioContentPath,
} from './scenario-content.js';
import { ScenariosController } from './scenarios.controller.js';
import { SCENARIO_CONTENT, ScenariosService } from './scenarios.service.js';

@Module({
  controllers: [ScenariosController],
  providers: [
    // Read and validated once at startup; an invalid file stops the app from starting.
    {
      provide: SCENARIO_CONTENT,
      useFactory: () => loadScenarioContent(scenarioContentPath()),
    },
    ScenariosService,
  ],
  exports: [ScenariosService],
})
export class ScenariosModule {}
