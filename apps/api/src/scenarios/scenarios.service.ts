import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Scenario, ScenarioContent } from './scenario-content.js';

export const SCENARIO_CONTENT = Symbol('SCENARIO_CONTENT');

// Public views are built field by field (API-02), so a new content field is never exposed by
// accident. coachRole and followUp are coach prompt material. transfer is never sent here: the
// transfer question must stay unseen until it is asked three days later. Hints come with the
// lesson (easy mode) and with the transfer hint call, which records that they were used.
export interface ScenarioSummary {
  id: string;
  pack: string;
  targetLanguage: string;
  area: string;
  mode: Scenario['mode'];
  titleTr: string;
  situationTr: string;
  skillTr: string;
}

export interface ScenarioDetail extends ScenarioSummary {
  skillEn: string;
  opening: string;
}

function toSummary(s: Scenario): ScenarioSummary {
  return {
    id: s.id,
    pack: s.pack,
    targetLanguage: s.targetLanguage,
    area: s.area,
    mode: s.mode,
    titleTr: s.titleTr,
    situationTr: s.situationTr,
    skillTr: s.skillTr,
  };
}

function toDetail(s: Scenario): ScenarioDetail {
  return {
    ...toSummary(s),
    skillEn: s.skillEn,
    opening: s.opening,
  };
}

@Injectable()
export class ScenariosService {
  private readonly byId: Map<string, Scenario>;
  private readonly packIds: Set<string>;

  constructor(
    @Inject(SCENARIO_CONTENT) private readonly content: ScenarioContent,
  ) {
    this.byId = new Map(content.scenarios.map((s) => [s.id, s]));
    this.packIds = new Set(content.packs.map((p) => p.id));
  }

  list(pack?: string): ScenarioSummary[] {
    if (pack !== undefined && !this.packIds.has(pack)) {
      throw new BadRequestException('Unknown pack');
    }
    return this.content.scenarios
      .filter((s) => pack === undefined || s.pack === pack)
      .map(toSummary);
  }

  get(id: string): ScenarioDetail {
    const scenario = this.byId.get(id);
    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }
    return toDetail(scenario);
  }

  /** Full scenario for server-side use (coach, transfer queue). Never return it to a client. */
  findInternal(id: string): Scenario | undefined {
    return this.byId.get(id);
  }
}
