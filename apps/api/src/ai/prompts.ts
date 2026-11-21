import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Prompts live in <repo>/prompts as Markdown: a header for people, a line with only `---`, then
// the prompt the model gets. Placeholders are {{name}}. They are read and checked once at
// startup; a missing file or placeholder stops the app (EXC-01).

export interface PromptTemplate {
  name: string;
  render(values: Record<string, string>): string;
}

export function promptsDir(): string {
  return (
    process.env.PROMPTS_DIR ??
    resolve(import.meta.dirname, '../../../../prompts')
  );
}

export function loadPrompt(
  name: string,
  placeholders: string[],
  dir = promptsDir(),
): PromptTemplate {
  const file = join(dir, `${name}.md`);
  const source = readFileSync(file, 'utf8');
  const marker = source.search(/^---\s*$/m);
  if (marker === -1) {
    throw new Error(`Prompt ${file} has no '---' line before the prompt body`);
  }
  const body = source
    .slice(marker)
    .replace(/^---\s*\n/, '')
    .trim();

  const found = new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
  const missing = placeholders.filter((p) => !found.has(p));
  const unknown = [...found].filter((p) => !placeholders.includes(p));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `Prompt ${file}: missing placeholders [${missing.join(', ')}], unknown placeholders [${unknown.join(', ')}]`,
    );
  }

  return {
    name,
    render(values) {
      return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
        const value = values[key];
        if (value === undefined) {
          throw new Error(`Prompt ${name}: no value for {{${key}}}`);
        }
        return value;
      });
    },
  };
}

export const COACH_PLACEHOLDERS = [
  'coachRole',
  'situationTr',
  'skillEn',
  'difficulty',
];
export const EVALUATOR_PLACEHOLDERS = ['skillEn'];
export const JUDGE_PLACEHOLDERS = ['skillEn', 'question', 'successTr'];

/**
 * Learner text goes inside tags in the user message, one line per turn: it must not be able to
 * close the tags or start a line of its own (a forged "COACH:" or "LEARNER:" line).
 */
export function asData(text: string): string {
  return text.replace(/[<>]/g, ' ').replace(/[\r\n\u2028\u2029]+/g, ' ');
}
