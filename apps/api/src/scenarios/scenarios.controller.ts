import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { scenarioIdSchema } from './scenario-content.js';
import { ScenariosService, type ScenarioDetail, type ScenarioSummary } from './scenarios.service.js';

const listScenariosQuerySchema = z.object({
  pack: scenarioIdSchema.optional(),
});

type ListScenariosQuery = z.infer<typeof listScenariosQuerySchema>;

@Controller('scenarios')
export class ScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get()
  list(@Query({ schema: listScenariosQuerySchema }) query: ListScenariosQuery): { scenarios: ScenarioSummary[] } {
    return { scenarios: this.scenarios.list(query.pack) };
  }

  @Get(':id')
  get(@Param('id', { schema: scenarioIdSchema }) id: string): ScenarioDetail {
    return this.scenarios.get(id);
  }
}
