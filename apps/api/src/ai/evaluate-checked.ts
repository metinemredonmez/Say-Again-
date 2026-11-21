import type {
  CorrectionDraft,
  EvaluationRequest,
  EvaluatorModel,
  Usage,
} from './ai.types.js';
import { checkCorrection } from './correction-guard.js';

export interface EvaluationAttempt {
  usage: Usage;
  draft: CorrectionDraft;
  problems: string[];
}

export interface CheckedEvaluation {
  /** The last draft the evaluator gave. */
  draft: CorrectionDraft;
  /** What the server checks found in it; empty when it can be shown. */
  problems: string[];
  attempts: number;
}

/**
 * The evaluator under the server checks (correction-guard.ts): when a draft breaks a rule, the
 * problems go back for one more try. Lessons and the quality evals (src/evals) both use this, so
 * the evals measure exactly what learners get. `onAttempt` runs after every call, before anything
 * else can fail, so its cost is always recorded (RES-01, AI-03).
 */
export async function evaluateChecked(
  evaluator: EvaluatorModel,
  request: Omit<EvaluationRequest, 'problems'>,
  learnerLines: string[],
  onAttempt: (attempt: EvaluationAttempt) => Promise<void> | void,
): Promise<CheckedEvaluation> {
  let problems: string[] | undefined;
  let draft: CorrectionDraft | undefined;
  let attempts = 0;
  while (attempts < 2) {
    attempts += 1;
    const result = await evaluator.evaluate({ ...request, problems });
    draft = result.draft;
    problems = checkCorrection(draft, learnerLines);
    await onAttempt({ usage: result.usage, draft, problems });
    if (problems.length === 0) {
      break;
    }
  }
  return { draft: draft!, problems: problems ?? [], attempts };
}
