import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

// Shape of content/scenarios.json. The file is the single source of truth for scenarios;
// the API validates it at startup and refuses to start if it is invalid (EXC-01: fail closed).

const slug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a lowercase slug');
const text = z.string().trim().min(1);

export const scenarioIdSchema = slug;

const packSchema = z.strictObject({
  id: slug,
  titleTr: text,
  descriptionTr: text,
});

const scenarioSchema = z.strictObject({
  id: slug,
  pack: slug,
  // ISO 639-1 code of the language being learned. MVP ships English only.
  targetLanguage: z.string().regex(/^[a-z]{2}$/, 'must be an ISO 639-1 code'),
  area: slug,
  mode: z.enum(['speak', 'write']),
  titleTr: text,
  situationTr: text,
  coachRole: text,
  opening: text,
  skillTr: text,
  skillEn: text,
  hints: z.array(text).min(1),
  followUp: text,
  transfer: z.strictObject({
    situationTr: text,
    question: text,
    successTr: text,
  }),
});

export const scenarioContentSchema = z
  .strictObject({
    version: z.literal(1),
    packs: z.array(packSchema).min(1),
    scenarios: z.array(scenarioSchema).min(1),
  })
  .superRefine((content, ctx) => {
    const packIds = new Set<string>();
    content.packs.forEach((pack, i) => {
      if (packIds.has(pack.id)) {
        ctx.addIssue({ code: 'custom', path: ['packs', i, 'id'], message: `duplicate pack id "${pack.id}"` });
      }
      packIds.add(pack.id);
    });

    const scenarioIds = new Set<string>();
    content.scenarios.forEach((scenario, i) => {
      if (scenarioIds.has(scenario.id)) {
        ctx.addIssue({ code: 'custom', path: ['scenarios', i, 'id'], message: `duplicate scenario id "${scenario.id}"` });
      }
      scenarioIds.add(scenario.id);

      if (!packIds.has(scenario.pack)) {
        ctx.addIssue({ code: 'custom', path: ['scenarios', i, 'pack'], message: `unknown pack "${scenario.pack}"` });
      }

      // Product rule: the transfer task asks a different question than the lesson.
      if (scenario.transfer.question.toLowerCase() === scenario.opening.toLowerCase()) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenarios', i, 'transfer', 'question'],
          message: 'transfer question must differ from the opening question',
        });
      }
    });
  });

export type ScenarioContent = z.infer<typeof scenarioContentSchema>;
export type Scenario = ScenarioContent['scenarios'][number];
export type Pack = ScenarioContent['packs'][number];

export function parseScenarioContent(raw: unknown): ScenarioContent {
  const result = scenarioContentSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid scenario content:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadScenarioContent(filePath: string): ScenarioContent {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read scenario content from ${filePath}`, { cause: error });
  }
  return parseScenarioContent(raw);
}

// src/scenarios and dist/scenarios sit at the same depth, so this resolves to <repo>/content
// in development, tests and the built app. CONTENT_DIR overrides it for deployments.
export function scenarioContentPath(): string {
  const contentDir = process.env.CONTENT_DIR ?? resolve(import.meta.dirname, '../../../../content');
  return join(contentDir, 'scenarios.json');
}
