import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { CATEGORIES, CORRECTION_KINDS } from '../database/schema.js';
import type { Scenario } from '../scenarios/scenario-content.js';
import {
  AiOutputError,
  AiUnavailableError,
  type CoachModel,
  type CoachReply,
  type CoachRequest,
  type CorrectionDraft,
  type EvaluationRequest,
  type EvaluatorModel,
  type TranscriptLine,
  type TransferJudgement,
  type Usage,
} from './ai.types.js';
import { tokenCostMicroUsd } from './pricing.js';
import { asData, type PromptTemplate } from './prompts.js';

// Claude for the coach (fast, cheap model) and the evaluator (strongest model), through the
// official Anthropic SDK. AI-01: learner text is never put in a system prompt; the coach gets it
// as user messages and the evaluator inside <transcript> tags in the user message.

const coachLineSchema = z.object({
  line: z
    .string()
    .describe(
      'Your next line in the scene, one or two short sentences, English only',
    ),
  move: z.enum(['follow_up', 'hint', 'closing']).describe('What the line does'),
});

const correctionSchema = z.object({
  kind: z.enum(CORRECTION_KINDS),
  original: z.string().describe("The learner's sentence, copied exactly"),
  improved: z
    .string()
    .describe('The same idea in correct, natural English, with no added facts'),
  explanationTr: z
    .string()
    .describe('At most two Turkish sentences explaining the one main change'),
  category: z.enum(CATEGORIES),
  resayPromptTr: z
    .string()
    .describe('One Turkish sentence asking the learner to say the idea again'),
});

const judgementSchema = z.object({
  passed: z.boolean(),
  feedbackTr: z.string().describe('One short Turkish sentence for the learner'),
});

const STAGE_NOTES: Record<CoachRequest['stage'], string> = {
  ask_follow_up:
    'This turn: ask your ONE follow-up question, built from something the learner actually said. ' +
    'If the learner is stuck, empty or off-topic, give one short hint and repeat your question in simpler words instead (move "hint").',
  close:
    'This turn: do NOT ask a new question. Close the scene with one short, friendly sentence (move "closing").',
};

function usageOf(
  model: string,
  usage: { input_tokens: number; output_tokens: number },
): Usage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    costMicroUsd: tokenCostMicroUsd(
      model,
      usage.input_tokens,
      usage.output_tokens,
    ),
  };
}

function wrapError(what: string, error: unknown): Error {
  if (error instanceof AiOutputError) {
    return error;
  }
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.AuthenticationError
  ) {
    // Configuration or request bug: not retryable by the user, but still no detail to the client.
    return new AiOutputError(`${what}: request rejected (${error.status})`, {
      cause: error,
    });
  }
  return new AiUnavailableError(`${what}: provider unavailable`, {
    cause: error,
  });
}

function transcriptBlock(transcript: TranscriptLine[]): string {
  const lines = transcript.map(
    (t) => `${t.speaker === 'coach' ? 'COACH' : 'LEARNER'}: ${asData(t.text)}`,
  );
  return `<transcript>\n${lines.join('\n')}\n</transcript>`;
}

export class ClaudeCoach implements CoachModel {
  private readonly logger = new Logger(ClaudeCoach.name);

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly prompt: PromptTemplate,
  ) {}

  async reply({
    scenario,
    difficulty,
    transcript,
    stage,
  }: CoachRequest): Promise<CoachReply> {
    const system = this.prompt.render({
      coachRole: scenario.coachRole,
      situationTr: scenario.situationTr,
      skillEn: scenario.skillEn,
      difficulty,
    });
    // The scene opens with a coach line, and the first message must be the user's.
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: '[The learner has joined the scene.]' },
      ...transcript.map((t): Anthropic.MessageParam => ({
        role: t.speaker === 'coach' ? 'assistant' : 'user',
        content: t.text,
      })),
      // Operator instruction for this turn, after the learner's message (mid-conversation system
      // message): it keeps the cached prefix and is not something the learner can forge.
      { role: 'system', content: STAGE_NOTES[stage] },
    ];

    try {
      const response = await this.client.messages.parse(
        {
          model: this.model,
          max_tokens: 4000,
          system: [
            {
              type: 'text',
              text: system,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages,
          output_config: {
            effort: 'low',
            format: zodOutputFormat(coachLineSchema),
          },
        },
        { timeout: 20_000 },
      );
      if (response.stop_reason === 'refusal') {
        this.logger.warn(
          `Coach refusal (${response.stop_details?.category ?? 'no category'})`,
        );
        throw new AiOutputError('Coach refused');
      }
      const parsed = response.parsed_output;
      if (!parsed || !parsed.line.trim()) {
        throw new AiOutputError(
          `Coach gave no line (stop reason ${response.stop_reason})`,
        );
      }
      return {
        text: parsed.line.trim(),
        move:
          stage === 'close'
            ? 'closing'
            : parsed.move === 'closing'
              ? 'follow_up'
              : parsed.move,
        usage: usageOf(this.model, response.usage),
      };
    } catch (error) {
      throw wrapError('Coach', error);
    }
  }
}

export class ClaudeEvaluator implements EvaluatorModel {
  private readonly logger = new Logger(ClaudeEvaluator.name);

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly evaluatorPrompt: PromptTemplate,
    private readonly judgePrompt: PromptTemplate,
  ) {}

  async evaluate({
    scenario,
    transcript,
    problems,
  }: EvaluationRequest): Promise<{ draft: CorrectionDraft; usage: Usage }> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: 'user', content: transcriptBlock(transcript) },
    ];
    if (problems && problems.length > 0) {
      messages.push({
        role: 'system',
        content: `Your previous correction broke these rules. Choose again and fix them:\n- ${problems.join('\n- ')}`,
      });
    }
    const object = await this.parse(
      'Evaluator',
      this.evaluatorPrompt.render({ skillEn: scenario.skillEn }),
      messages,
      correctionSchema,
    );
    return { draft: object.value, usage: object.usage };
  }

  async judgeTransfer({
    scenario,
    answer,
  }: {
    scenario: Scenario;
    answer: string;
  }): Promise<TransferJudgement> {
    const system = this.judgePrompt.render({
      skillEn: scenario.skillEn,
      question: scenario.transfer.question,
      successTr: scenario.transfer.successTr,
    });
    const object = await this.parse(
      'Transfer judge',
      system,
      [{ role: 'user', content: `<answer>\n${asData(answer)}\n</answer>` }],
      judgementSchema,
    );
    return { ...object.value, usage: object.usage };
  }

  private async parse<T extends z.ZodType>(
    what: string,
    system: string,
    messages: Anthropic.Beta.BetaMessageParam[],
    schema: T,
  ): Promise<{ value: z.infer<T>; usage: Usage }> {
    try {
      // Server-side refusal fallback: on a policy decline the API re-runs the request on a
      // fallback model inside the same call.
      const response = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system,
          messages,
          output_config: {
            effort: 'high',
            format: betaZodOutputFormat(schema),
          },
        },
        // 2 attempts x 2 tries x 60 s stays inside the lesson's 6-minute evaluation lease.
        { timeout: 60_000, maxRetries: 1 },
      );
      if (response.stop_reason === 'refusal') {
        this.logger.warn(
          `${what} refusal (${response.stop_details?.category ?? 'no category'})`,
        );
        throw new AiOutputError(`${what} refused`);
      }
      const value = response.parsed_output as z.infer<T> | null;
      if (!value) {
        throw new AiOutputError(
          `${what} gave no parsable output (stop reason ${response.stop_reason})`,
        );
      }
      return {
        value,
        usage: usageOf(response.model ?? this.model, response.usage),
      };
    } catch (error) {
      throw wrapError(what, error);
    }
  }
}
