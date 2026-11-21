import OpenAI, { toFile } from 'openai';
import type { Scenario } from '../scenarios/scenario-content.js';
import {
  AiOutputError,
  AiUnavailableError,
  type AudioInput,
  type Difficulty,
  type SpeechToText,
  type SpokenAudio,
  type TextToSpeech,
  type Transcription,
} from './ai.types.js';
import {
  sttCostMicroUsd,
  tokenCostMicroUsd,
  ttsCostMicroUsd,
} from './pricing.js';

// OpenAI for speech. The audio is sent once and kept nowhere on our side; OpenAI keeps no
// transcription data and keeps speech requests for 30 days of abuse monitoring
// (developers.openai.com/api/docs/guides/your-data).
//
// NOTE: OpenAI shuts down every /v1/audio/speech model (gpt-4o-mini-tts included) on
// 2027-01-06. TextToSpeech is an interface: swap this class before that date.

function wrapError(what: string, error: unknown): Error {
  if (
    error instanceof OpenAI.BadRequestError ||
    error instanceof OpenAI.AuthenticationError
  ) {
    return new AiOutputError(`${what}: request rejected (${error.status})`, {
      cause: error,
    });
  }
  return new AiUnavailableError(`${what}: provider unavailable`, {
    cause: error,
  });
}

export class OpenAiSpeechToText implements SpeechToText {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async transcribe(
    audio: AudioInput,
    { scenario }: { scenario: Scenario },
  ): Promise<Transcription> {
    try {
      const file = await toFile(audio.data, audio.filename, {
        type: audio.mimeType,
      });
      const result = await this.client.audio.transcriptions.create(
        {
          file,
          model: this.model,
          ...(this.model === 'gpt-transcribe'
            ? { languages: ['en'] }
            : { language: 'en' }),
          // Context in English, the language of the audio: what the learner is talking about.
          prompt: `An English learner whose first language is Turkish, speaking in this situation: ${scenario.coachRole}`,
        },
        { timeout: 30_000 },
      );
      const usage = result.usage;
      // Billing is per minute for gpt-transcribe; without a duration in the answer, estimate it
      // from the file size (AAC at about 64 kbit/s).
      const durationMs =
        usage?.type === 'duration'
          ? Math.round(usage.seconds * 1000)
          : Math.round((audio.data.length / 8000) * 1000);
      const costMicroUsd =
        usage?.type === 'tokens' && !this.model.startsWith('gpt-transcribe')
          ? tokenCostMicroUsd(
              this.model,
              usage.input_tokens,
              usage.output_tokens,
            )
          : sttCostMicroUsd(this.model, durationMs);
      return { text: result.text.trim(), durationMs, costMicroUsd };
    } catch (error) {
      throw wrapError('Speech to text', error);
    }
  }
}

export class OpenAiTextToSpeech implements TextToSpeech {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly voice: string,
  ) {}

  async synthesize(
    text: string,
    { difficulty }: { difficulty: Difficulty },
  ): Promise<SpokenAudio> {
    try {
      const response = await this.client.audio.speech.create(
        {
          model: this.model,
          voice: this.voice,
          input: text.slice(0, 4000),
          response_format: 'mp3',
          instructions:
            difficulty === 'easy'
              ? 'Speak slowly and clearly, with short pauses between phrases, for an intermediate English learner.'
              : 'Speak naturally, at a normal conversational pace, like a friendly native speaker.',
        },
        { timeout: 20_000 },
      );
      const data = Buffer.from(await response.arrayBuffer());
      return {
        data,
        mimeType: 'audio/mpeg',
        chars: text.length,
        costMicroUsd: ttsCostMicroUsd(this.model, text.length),
      };
    } catch (error) {
      throw wrapError('Text to speech', error);
    }
  }
}
