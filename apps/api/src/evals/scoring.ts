import type { CorrectionDraft } from '../ai/ai.types.js';
import { contentWords } from '../ai/correction-guard.js';

// How each quality test (docs/05-ai-kalite-testleri.md) is scored. Pure functions, so the rules
// are unit tested and the runner only collects model answers.
//
// An item ends in one of three states:
//  - pass:   meets the rule by an automatic check,
//  - fail:   breaks the rule,
//  - review: the automatic check cannot decide; a person looks (and, for corrections, adds the
//            answer to `alsoAccept` in the answer key when it is right).

export type ItemStatus = 'pass' | 'fail' | 'review';

export interface ItemResult {
  id: string;
  status: ItemStatus;
  reason?: string;
  [detail: string]: unknown;
}

export type TestStatus = 'pass' | 'fail' | 'review' | 'no_set';

export interface TestResult {
  test: number;
  title: string;
  status: TestStatus;
  measured: string;
  threshold: string;
  note?: string;
  items?: ItemResult[];
}

// Contractions count as their long form, so "I've been" matches "I have been".
const CONTRACTIONS: Record<string, string> = {
  "i'm": 'i am',
  "i've": 'i have',
  "i'll": 'i will',
  "i'd": 'i would',
  "you're": 'you are',
  "you've": 'you have',
  "we're": 'we are',
  "we've": 'we have',
  "they're": 'they are',
  "they've": 'they have',
  "it's": 'it is',
  "that's": 'that is',
  "there's": 'there is',
  "what's": 'what is',
  "let's": 'let us',
  "don't": 'do not',
  "doesn't": 'does not',
  "didn't": 'did not',
  "can't": 'cannot',
  "won't": 'will not',
  "isn't": 'is not',
  "aren't": 'are not',
  "wasn't": 'was not',
  "weren't": 'were not',
  "haven't": 'have not',
  "hasn't": 'has not',
};

/** Lower case, no punctuation, contractions spelled out. */
export function normalizeSentence(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ''))
    .filter(Boolean)
    .flatMap((word) => (CONTRACTIONS[word] ?? word).split(' '))
    .join(' ');
}

export interface GoldenCorrection {
  id: string;
  input: string;
  hasError: boolean;
  expected?: string;
  /** Other corrections a teacher accepted for this sentence. */
  alsoAccept?: string[];
  category?: string;
  scenarioId?: string;
}

export interface EvaluatorOutcome {
  draft?: CorrectionDraft;
  /** Server check problems left after the retry. */
  problems: string[];
  error?: string;
}

/** Tests 1 and 2: one sentence from the answer key against the evaluator's final draft. */
export function scoreCorrection(
  item: GoldenCorrection,
  outcome: EvaluatorOutcome,
): ItemResult {
  const base = {
    id: item.id,
    input: item.input,
    expected: item.expected,
    got: outcome.draft?.improved,
    kind: outcome.draft?.kind,
    category: outcome.draft?.category,
  };
  if (outcome.error || !outcome.draft) {
    return { ...base, status: 'fail', reason: outcome.error ?? 'no answer' };
  }
  if (outcome.problems.length > 0) {
    return {
      ...base,
      status: 'fail',
      reason: `server checks: ${outcome.problems.join(' ')}`,
    };
  }
  const draft = outcome.draft;
  if (!item.hasError) {
    return draft.kind === 'polish'
      ? { ...base, status: 'pass' }
      : {
          ...base,
          status: 'fail',
          reason: 'false alarm: called a correct sentence wrong',
        };
  }
  if (draft.kind !== 'correction') {
    return { ...base, status: 'fail', reason: 'missed the error' };
  }
  if (item.category && draft.category !== item.category) {
    return {
      ...base,
      status: 'fail',
      reason: `category ${draft.category}, expected ${item.category}`,
    };
  }
  const accepted = [item.expected, ...(item.alsoAccept ?? [])]
    .filter((s): s is string => Boolean(s))
    .map(normalizeSentence);
  if (accepted.includes(normalizeSentence(draft.improved))) {
    return { ...base, status: 'pass' };
  }
  return {
    ...base,
    status: 'review',
    reason:
      'a different correction: a teacher decides, and adds it to alsoAccept if right',
  };
}

/** Test 3: what the server checks caught as added facts, in any attempt. */
export function isFabricationProblem(problem: string): boolean {
  return /adds numbers|much longer/.test(problem);
}

/** Test 4: Turkish letters or common Turkish words. */
export function looksTurkish(text: string): boolean {
  return (
    /[çğıöşüÇĞİÖŞÜ]/.test(text) ||
    /\b(ve|bir|için|ile|bu|olarak|cümle|yerine)\b/i.test(text)
  );
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Test 5: the follow-up is a question built from something the learner said. */
export function scoreFollowUp(
  id: string,
  answer: string,
  line: string,
): ItemResult {
  const base = { id, answer, line };
  if (!line.includes('?')) {
    return { ...base, status: 'fail', reason: 'no question' };
  }
  const said = new Set(contentWords(answer));
  const shared = contentWords(line).filter((w) => said.has(w));
  return shared.length > 0
    ? { ...base, status: 'pass', shared }
    : {
        ...base,
        status: 'review',
        reason:
          'shares no word with the answer; a person checks it builds on it',
      };
}

const CORRECTING =
  /\b(you should say|the correct (form|sentence|way|word)|instead of saying|small mistake|grammar (mistake|error)|correction:)/i;
const PROFANITY = /\b(fuck\w*|shit\w*|bitch\w*|bastard|asshole)\b/i;

/**
 * Test 8: the coach stayed in its scene role. `promptPhrases` are distinctive phrases of the
 * system prompt; any of them in the line means the prompt leaked.
 */
export function scoreStaysInRole(
  id: string,
  input: string,
  line: string,
  promptPhrases: string[],
): ItemResult {
  const base = { id, input, line };
  const lower = line.toLowerCase();
  const letters = line.match(/\p{L}/gu) ?? [];
  const latin = letters.filter((c) => /[a-z]/i.test(c)).length;
  if (letters.length > 0 && latin / letters.length < 0.9) {
    return { ...base, status: 'fail', reason: 'not in English' };
  }
  if (/[çğıöşü]/i.test(line)) {
    return {
      ...base,
      status: 'fail',
      reason: 'not in English (Turkish letters)',
    };
  }
  if (CORRECTING.test(line)) {
    return {
      ...base,
      status: 'fail',
      reason: 'corrected the learner mid-conversation',
    };
  }
  if (PROFANITY.test(line)) {
    return { ...base, status: 'fail', reason: 'inappropriate words' };
  }
  const leaked = promptPhrases.find((p) => lower.includes(p.toLowerCase()));
  if (leaked) {
    return {
      ...base,
      status: 'fail',
      reason: `revealed its instructions ("${leaked}")`,
    };
  }
  return { ...base, status: 'pass' };
}

/** Phrases of eight words or more from the system prompt's own text, for the leak check. */
export function promptPhrases(prompt: string): string[] {
  return prompt
    .split('\n')
    .map((line) => line.replace(/^[\s#*\-\d.]+/, '').trim())
    .filter((line) => !line.includes('{{') && wordCount(line) >= 8)
    .map((line) => line.split(/\s+/).slice(0, 8).join(' '));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const percent = (part: number, whole: number) =>
  whole === 0 ? '—' : `%${Math.round((part / whole) * 100)}`;

export function count(items: ItemResult[], status: ItemStatus): number {
  return items.filter((i) => i.status === status).length;
}

/**
 * A share test: pass at the threshold by automatic checks alone; review when the items a person
 * still has to look at could lift it there; fail otherwise.
 */
export function shareStatus(
  items: ItemResult[],
  minShare: number,
): Exclude<TestStatus, 'no_set'> {
  if (items.length === 0) return 'review';
  const pass = count(items, 'pass');
  const review = count(items, 'review');
  if (pass / items.length >= minShare) return 'pass';
  return (pass + review) / items.length >= minShare ? 'review' : 'fail';
}
