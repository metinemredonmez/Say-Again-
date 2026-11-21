import type { Scenario } from '../scenarios/scenario-content.js';
import type {
  CATEGORIES,
  CORRECTION_KINDS,
  DIFFICULTIES,
} from '../database/schema.js';

// The four provider interfaces. Lesson code depends only on these; providers can change without
// touching lessons, and the whole module can move to its own service later (docs/KARARLAR.md).

export interface AudioInput {
  data: Buffer;
  mimeType: string;
  filename: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

export interface Transcription {
  text: string;
  durationMs: number;
  costMicroUsd: number;
}

export interface SpokenAudio {
  data: Buffer;
  mimeType: string;
  chars: number;
  costMicroUsd: number;
}

export interface TranscriptLine {
  speaker: 'coach' | 'learner';
  text: string;
}

export type Difficulty = (typeof DIFFICULTIES)[number];
export type CoachMove = 'follow_up' | 'hint' | 'closing';
/** What the coach's next line is for; the lesson flow decides it, not the model. */
export type CoachStage = 'ask_follow_up' | 'close';

export interface CoachRequest {
  scenario: Scenario;
  difficulty: Difficulty;
  transcript: TranscriptLine[];
  stage: CoachStage;
}

export interface CoachReply {
  text: string;
  move: CoachMove;
  usage: Usage;
}

export interface CorrectionDraft {
  kind: (typeof CORRECTION_KINDS)[number];
  original: string;
  improved: string;
  explanationTr: string;
  category: (typeof CATEGORIES)[number];
  resayPromptTr: string;
}

export interface EvaluationRequest {
  scenario: Scenario;
  transcript: TranscriptLine[];
  /** Problems the server found in an earlier draft, for one retry. */
  problems?: string[];
}

export interface TransferJudgement {
  passed: boolean;
  feedbackTr: string;
  usage: Usage;
}

export interface SpeechToText {
  transcribe(
    audio: AudioInput,
    context: { scenario: Scenario },
  ): Promise<Transcription>;
}

export interface CoachModel {
  reply(request: CoachRequest): Promise<CoachReply>;
}

export interface EvaluatorModel {
  evaluate(
    request: EvaluationRequest,
  ): Promise<{ draft: CorrectionDraft; usage: Usage }>;
  judgeTransfer(request: {
    scenario: Scenario;
    answer: string;
  }): Promise<TransferJudgement>;
}

export interface TextToSpeech {
  synthesize(
    text: string,
    options: { difficulty: Difficulty },
  ): Promise<SpokenAudio>;
}

export const SPEECH_TO_TEXT = Symbol('SpeechToText');
export const COACH_MODEL = Symbol('CoachModel');
export const EVALUATOR_MODEL = Symbol('EvaluatorModel');
export const TEXT_TO_SPEECH = Symbol('TextToSpeech');

/** A provider failed or timed out; the request can be retried. */
export class AiUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiUnavailableError';
  }
}

/** The model answered, but not with something the product can use (refusal, bad output). */
export class AiOutputError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiOutputError';
  }
}
