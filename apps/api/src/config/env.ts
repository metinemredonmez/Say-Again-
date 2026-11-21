import { z } from 'zod';
import { isPriced } from '../ai/pricing.js';

// Every setting the API reads, validated once at startup. A missing or invalid value stops the
// app from starting (EXC-01, OPS-01). Secrets come only from the environment (apps/api/.env).

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const optionalText = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v));
const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
const count = (fallback: number) =>
  z.coerce.number().int().min(0).max(100_000).default(fallback);

// The secret the test configs use (vitest.config*.ts). It is public, so production refuses it.
const TEST_JWT_SECRET = 'test-only-jwt-secret-of-at-least-32-bytes';

/** Why a JWT secret is unfit for production, or null. */
export function jwtSecretWeakness(secret: string): string | null {
  if (secret === TEST_JWT_SECRET) {
    return 'is the public test secret';
  }
  if (/secret|change|example|test|password|default|placeholder/i.test(secret)) {
    return 'looks like a placeholder';
  }
  if (new Set(secret).size < 10) {
    return 'repeats too few characters to be random';
  }
  return null;
}

/** True when a postgres:// URL asks for TLS, or points at this machine. */
export function databaseUsesTls(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode && ['require', 'verify-ca', 'verify-full'].includes(sslmode)) {
    return true;
  }
  return ['localhost', '127.0.0.1', '[::1]', ''].includes(parsed.hostname);
}

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // NET-03: off unless the hosting proxy is known. Values Express accepts: 'loopback', a hop
    // count such as '1', or a comma-separated list of proxy addresses.
    TRUST_PROXY: optionalText,

    // postgres://... in production. pglite:memory or pglite:<folder> runs PostgreSQL in-process
    // (tests, and local work without a PostgreSQL server).
    DATABASE_URL: z.string().min(1),
    DATABASE_MIGRATE: bool.optional(),
    CONTENT_DIR: optionalText,
    PROMPTS_DIR: optionalText,

    // HS256 secret for access tokens, at least 32 bytes: openssl rand -base64 32
    JWT_SECRET: z.string().min(32),

    // mock: deterministic fakes, no keys, no cost. live: Claude for the coach and the evaluator,
    // OpenAI for speech.
    AI_PROVIDER: z.enum(['mock', 'live']).default('mock'),
    ANTHROPIC_API_KEY: optionalText,
    OPENAI_API_KEY: optionalText,
    COACH_MODEL: z.string().default('claude-haiku-5-5'),
    EVALUATOR_MODEL: z.string().default('claude-opus-5-5'),
    STT_MODEL: z.string().default('gpt-transcribe'),
    TTS_MODEL: z.string().default('gpt-4o-mini-tts'),
    TTS_VOICE: z.string().default('marin'),

    // Quotas (product rules): three free lessons, then 20 a month with a subscription. The daily
    // caps bound AI spend from abandoned lessons and from throwaway anonymous accounts (RES-01).
    FREE_LESSONS: count(3),
    MONTHLY_LESSONS: count(20),
    DAILY_LESSON_STARTS: count(10),
    // Daily AI spend caps in USD, counted from the recorded cost of every call.
    DAILY_USER_AI_BUDGET_USD: z.coerce.number().min(0).default(1.5),
    GLOBAL_DAILY_AI_BUDGET_USD: z.coerce.number().min(0).default(100),
    // Pilot switch: lessons without a subscription check, still bounded by the daily caps.
    PAYWALL_ENABLED: bool.default(true),

    // Store subscriptions, verified directly with Apple and Google.
    SUBSCRIPTION_PRODUCT_IDS: csv,
    APPLE_BUNDLE_ID: optionalText,
    APPLE_APP_APPLE_ID: z.coerce.number().int().positive().optional(),
    APPLE_ISSUER_ID: optionalText,
    APPLE_KEY_ID: optionalText,
    APPLE_PRIVATE_KEY: optionalText,
    APPLE_ENVIRONMENT: z.enum(['Sandbox', 'Production']).default('Sandbox'),
    APPLE_ROOT_CERTS_DIR: optionalText,
    GOOGLE_PACKAGE_NAME: optionalText,
    GOOGLE_SERVICE_ACCOUNT_JSON: optionalText,
    GOOGLE_PUBSUB_AUDIENCE: optionalText,
    GOOGLE_PUBSUB_SERVICE_ACCOUNT: optionalText,
  })
  .superRefine((env, ctx) => {
    const need = (key: keyof typeof env, why: string) => {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `required ${why}`,
        });
      }
    };
    if (env.AI_PROVIDER === 'live') {
      need('ANTHROPIC_API_KEY', 'when AI_PROVIDER=live');
      need('OPENAI_API_KEY', 'when AI_PROVIDER=live');
      // RES-01, EXC-01: a model without a price would count as free and slip past the daily
      // spend budgets, so the app does not start with one.
      for (const key of [
        'COACH_MODEL',
        'EVALUATOR_MODEL',
        'STT_MODEL',
        'TTS_MODEL',
      ] as const) {
        if (!isPriced(env[key])) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${env[key]} has no price in src/ai/pricing.ts; add it there first`,
          });
        }
      }
    }
    if (env.NODE_ENV === 'production') {
      if (env.AI_PROVIDER !== 'live') {
        ctx.addIssue({
          code: 'custom',
          path: ['AI_PROVIDER'],
          message: 'must be live in production',
        });
      }
      if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message: 'must be a postgres:// URL in production',
        });
      } else if (!databaseUsesTls(env.DATABASE_URL)) {
        // NET-01: no plaintext database connection across a network.
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message:
            'needs sslmode=verify-full (or require) in production, unless the database is on localhost',
        });
      }
      const weakness = jwtSecretWeakness(env.JWT_SECRET);
      if (weakness) {
        // KEY-01: a placeholder or guessable secret would let anyone sign access tokens.
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_SECRET'],
          message: `${weakness}; make one with: openssl rand -base64 32`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;
