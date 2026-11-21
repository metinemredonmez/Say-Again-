import Anthropic from '@anthropic-ai/sdk';
import { Logger, Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { Env } from '../config/env.js';
import {
  COACH_MODEL,
  EVALUATOR_MODEL,
  SPEECH_TO_TEXT,
  TEXT_TO_SPEECH,
} from './ai.types.js';
import { ClaudeCoach, ClaudeEvaluator } from './anthropic-providers.js';
import {
  MockCoach,
  MockEvaluator,
  MockSpeechToText,
  MockTextToSpeech,
} from './mock-providers.js';
import { OpenAiSpeechToText, OpenAiTextToSpeech } from './openai-providers.js';
import { isPriced } from './pricing.js';
import {
  COACH_PLACEHOLDERS,
  EVALUATOR_PLACEHOLDERS,
  JUDGE_PLACEHOLDERS,
  loadPrompt,
} from './prompts.js';

// AI_PROVIDER=mock uses the deterministic fakes; live uses Claude and OpenAI. Keys are read only
// here, on the server (CLAUDE.md: keys never go to the mobile app).

const ANTHROPIC = Symbol('Anthropic');
const OPENAI = Symbol('OpenAI');
const live = (config: ConfigService<Env, true>) =>
  config.get('AI_PROVIDER', { infer: true }) === 'live';

const providers: Provider[] = [
  {
    provide: ANTHROPIC,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>) =>
      live(config)
        ? new Anthropic({
            apiKey: config.get('ANTHROPIC_API_KEY', { infer: true }),
            maxRetries: 2,
          })
        : null,
  },
  {
    provide: OPENAI,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>) =>
      live(config)
        ? new OpenAI({
            apiKey: config.get('OPENAI_API_KEY', { infer: true }),
            maxRetries: 2,
          })
        : null,
  },
  {
    provide: COACH_MODEL,
    inject: [ConfigService, ANTHROPIC],
    useFactory: (
      config: ConfigService<Env, true>,
      client: Anthropic | null,
    ) => {
      // Prompts are loaded in mock mode too, so a broken prompt file fails every environment.
      const prompt = loadPrompt('coach', COACH_PLACEHOLDERS);
      return client
        ? new ClaudeCoach(
            client,
            config.get('COACH_MODEL', { infer: true }),
            prompt,
          )
        : new MockCoach();
    },
  },
  {
    provide: EVALUATOR_MODEL,
    inject: [ConfigService, ANTHROPIC],
    useFactory: (
      config: ConfigService<Env, true>,
      client: Anthropic | null,
    ) => {
      const evaluator = loadPrompt('evaluator', EVALUATOR_PLACEHOLDERS);
      const judge = loadPrompt('transfer-judge', JUDGE_PLACEHOLDERS);
      return client
        ? new ClaudeEvaluator(
            client,
            config.get('EVALUATOR_MODEL', { infer: true }),
            evaluator,
            judge,
          )
        : new MockEvaluator();
    },
  },
  {
    provide: SPEECH_TO_TEXT,
    inject: [ConfigService, OPENAI],
    useFactory: (config: ConfigService<Env, true>, client: OpenAI | null) =>
      client
        ? new OpenAiSpeechToText(
            client,
            config.get('STT_MODEL', { infer: true }),
          )
        : new MockSpeechToText(),
  },
  {
    provide: TEXT_TO_SPEECH,
    inject: [ConfigService, OPENAI],
    useFactory: (config: ConfigService<Env, true>, client: OpenAI | null) =>
      client
        ? new OpenAiTextToSpeech(
            client,
            config.get('TTS_MODEL', { infer: true }),
            config.get('TTS_VOICE', { infer: true }),
          )
        : new MockTextToSpeech(),
  },
];

@Module({
  providers: [
    ...providers,
    {
      provide: 'AI_PRICING_CHECK',
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        if (live(config)) {
          const logger = new Logger('AiModule');
          for (const key of [
            'COACH_MODEL',
            'EVALUATOR_MODEL',
            'STT_MODEL',
            'TTS_MODEL',
          ] as const) {
            const model = config.get(key, { infer: true });
            if (!isPriced(model)) {
              logger.warn(
                `${key}=${model} has no price in ai/pricing.ts; its cost is logged as 0`,
              );
            }
          }
        }
        return true;
      },
    },
  ],
  exports: [COACH_MODEL, EVALUATOR_MODEL, SPEECH_TO_TEXT, TEXT_TO_SPEECH],
})
export class AiModule {}
