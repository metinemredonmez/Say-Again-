// List prices for cost logging (quality test 10), in USD. Checked 2026-11-20:
// Claude from the Anthropic model table, OpenAI from developers.openai.com/api/docs/pricing.
// A price per million tokens is the same number of micro-dollars per token.

const TOKEN_PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 }, // prompts up to 100K tokens
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'gpt-4o-transcribe': { input: 2.5, output: 10 },
  'gpt-4o-mini-transcribe': { input: 1.25, output: 5 },
};

const STT_PER_MINUTE: Record<string, number> = {
  'gpt-transcribe': 0.0045,
  'whisper-1': 0.006,
};

// gpt-4o-mini-tts bills audio output tokens and returns no usage, so the cost is an estimate per
// input character (about 900 characters per spoken minute at roughly $0.015 a minute).
const TTS_PER_MILLION_CHARS: Record<string, number> = {
  'gpt-4o-mini-tts': 15,
  'tts-1': 15,
  'tts-1-hd': 30,
};

export function tokenCostMicroUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = TOKEN_PRICES[model];
  if (!price) {
    return 0;
  }
  return Math.round(inputTokens * price.input + outputTokens * price.output);
}

export function sttCostMicroUsd(model: string, durationMs: number): number {
  const perMinute = STT_PER_MINUTE[model];
  return perMinute
    ? Math.round((durationMs / 60_000) * perMinute * 1_000_000)
    : 0;
}

export function ttsCostMicroUsd(model: string, chars: number): number {
  const perMillion = TTS_PER_MILLION_CHARS[model];
  return perMillion ? Math.round(chars * perMillion) : 0;
}

export function isPriced(model: string): boolean {
  return (
    model in TOKEN_PRICES ||
    model in STT_PER_MINUTE ||
    model in TTS_PER_MILLION_CHARS
  );
}
