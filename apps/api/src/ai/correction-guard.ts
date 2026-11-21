import type { CorrectionDraft } from './ai.types.js';

// Server-side checks of a correction, whatever the model: the product rules "one correction",
// "the learner's own sentence" and "no invented facts" (CLAUDE.md). A draft that fails gets one
// retry with the problems spelled out; a second failure is not shown to the learner.

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const NUMBER_WORDS = new Set(
  (
    'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen ' +
    'fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy ' +
    'eighty ninety hundred thousand million billion dozen half percent first second third'
  ).split(' '),
);

const STOPWORDS = new Set(
  (
    'the a an and or but to of in on at for with from by as is are was were be been am do does ' +
    'did have has had i you he she it we they my your his her its our their me him us them ' +
    'this that these those there here not no yes so very can could will would should'
  ).split(' '),
);

/** Digits and spelled-out numbers in a text. */
function numbers(text: string): Set<string> {
  const found = new Set(text.match(/\d+(?:[.,]\d+)?/g) ?? []);
  for (const word of normalize(text).split(' ')) {
    if (NUMBER_WORDS.has(word)) {
      found.add(word);
    }
  }
  return found;
}

/** Lower-case words of three or more letters that carry meaning. */
export function contentWords(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** A learner line and each of its sentences, normalized. */
function candidates(lines: string[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines) {
    out.add(normalize(line));
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      out.add(normalize(sentence));
    }
  }
  return out;
}

function sentenceCount(text: string): number {
  return text
    .split(/[.!?]+(?:\s|$)/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

export function checkCorrection(
  draft: CorrectionDraft,
  learnerLines: string[],
): string[] {
  const problems: string[] = [];
  const original = normalize(draft.original);
  const improved = normalize(draft.improved);

  // A whole sentence (or line) the learner said, not a fragment of one.
  if (!original || !candidates(learnerLines).has(original)) {
    problems.push(
      '`original` must be one whole sentence copied exactly from the LEARNER lines.',
    );
  }
  if (!improved) {
    problems.push('`improved` is empty.');
  }
  if (draft.kind === 'correction' && original === improved) {
    problems.push(
      '`kind` is "correction" but `improved` is the same sentence; use "polish" or fix the error.',
    );
  }
  const originalNumbers = numbers(draft.original);
  const added = [...numbers(draft.improved)].filter(
    (n) => !originalNumbers.has(n),
  );
  if (added.length > 0) {
    problems.push(
      `\`improved\` adds numbers the learner did not say (${added.join(', ')}). Do not add facts.`,
    );
  }
  const originalWords = original.split(' ').length;
  const improvedWords = improved.split(' ').length;
  if (improvedWords > Math.ceil(originalWords * 1.5) + 3) {
    problems.push(
      '`improved` is much longer than the original; say the same thing, not more.',
    );
  }
  const sentences = sentenceCount(draft.explanationTr);
  if (sentences === 0 || sentences > 2) {
    problems.push('`explanationTr` must be one or two Turkish sentences.');
  }
  if (draft.explanationTr.length > 400) {
    problems.push('`explanationTr` is too long; keep it short.');
  }
  if (!draft.resayPromptTr.trim()) {
    problems.push('`resayPromptTr` is empty.');
  } else if (draft.resayPromptTr.length > 300) {
    problems.push('`resayPromptTr` must be one short sentence.');
  }
  return problems;
}
