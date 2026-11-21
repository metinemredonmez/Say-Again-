import type {
  CoachModel,
  CoachReply,
  CoachRequest,
  CorrectionDraft,
  EvaluationRequest,
  EvaluatorModel,
  SpeechToText,
  SpokenAudio,
  TextToSpeech,
  Transcription,
  TransferJudgement,
} from './ai.types.js';

// Deterministic stand-ins for AI_PROVIDER=mock: no keys, no network, no cost. They let the whole
// lesson flow run in development and in tests. They are not a quality reference.

const NO_USAGE = { inputTokens: 0, outputTokens: 0, costMicroUsd: 0 };

/** Mock transcript used for every uploaded recording. */
export const MOCK_TRANSCRIPT = 'I am working here since three years.';

export class MockSpeechToText implements SpeechToText {
  async transcribe(): Promise<Transcription> {
    return { text: MOCK_TRANSCRIPT, durationMs: 3000, costMicroUsd: 0 };
  }
}

export class MockCoach implements CoachModel {
  async reply({ scenario, stage }: CoachRequest): Promise<CoachReply> {
    if (stage === 'close') {
      return {
        text: 'Thanks, that was helpful. That is all for now.',
        move: 'closing',
        usage: NO_USAGE,
      };
    }
    return { text: scenario.followUp, move: 'follow_up', usage: NO_USAGE };
  }
}

export class MockEvaluator implements EvaluatorModel {
  async evaluate({ transcript }: EvaluationRequest): Promise<{
    draft: CorrectionDraft;
    usage: typeof NO_USAGE;
  }> {
    const original =
      transcript.find((line) => line.speaker === 'learner')?.text ?? '';
    const draft: CorrectionDraft =
      original === MOCK_TRANSCRIPT
        ? {
            kind: 'correction',
            original,
            improved: 'I have been working here for three years.',
            explanationTr:
              'Geçmişte başlayıp hâlâ süren işler için present perfect continuous kullanılır. Süre için "since" değil "for" gelir.',
            category: 'tense',
            resayPromptTr: 'Aynı fikri kendi cümlenle yeniden söyle.',
          }
        : {
            kind: 'polish',
            original,
            improved: original,
            explanationTr: 'Bu cümle doğru ve anlaşılır.',
            category: 'other',
            resayPromptTr: 'Aynı fikri kendi cümlenle yeniden söyle.',
          };
    return { draft, usage: NO_USAGE };
  }

  async judgeTransfer({
    answer,
  }: {
    answer: string;
  }): Promise<TransferJudgement> {
    const passed = answer.trim().split(/\s+/).length >= 4;
    return {
      passed,
      feedbackTr: passed
        ? 'Görevi yerine getirdin.'
        : 'Cevap görevi tamamlamak için çok kısa.',
      usage: NO_USAGE,
    };
  }
}

export class MockTextToSpeech implements TextToSpeech {
  async synthesize(text: string): Promise<SpokenAudio> {
    return {
      data: Buffer.from(`MOCK-AUDIO:${text}`),
      mimeType: 'audio/mpeg',
      chars: text.length,
      costMicroUsd: 0,
    };
  }
}
