import { randomBytes } from 'node:crypto';
import { envSchema } from './env.js';

const base = { DATABASE_URL: 'pglite:memory', JWT_SECRET: 'x'.repeat(32) };
// A made-up value of the right shape (openssl rand -base64 32).
const STRONG_SECRET = 'q8Yv3kLz0PfR7wNc2TgHb5Ux9JdMa4Ks6Ee1Wn+Q0rI=';

describe('environment validation (fail closed)', () => {
  it('starts with safe defaults in development', () => {
    const env = envSchema.parse(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      AI_PROVIDER: 'mock',
      FREE_LESSONS: 3,
      MONTHLY_LESSONS: 20,
      PAYWALL_ENABLED: true,
    });
    expect(env.COACH_MODEL).toBe('claude-haiku-5-5');
    expect(env.EVALUATOR_MODEL).toBe('claude-opus-5-5');
  });

  it('refuses a short signing secret', () => {
    expect(envSchema.safeParse({ ...base, JWT_SECRET: 'short' }).success).toBe(
      false,
    );
  });

  it('needs both AI keys for live mode', () => {
    expect(
      envSchema.safeParse({
        ...base,
        AI_PROVIDER: 'live',
        ANTHROPIC_API_KEY: 'a',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...base,
        AI_PROVIDER: 'live',
        ANTHROPIC_API_KEY: 'a',
        OPENAI_API_KEY: 'b',
      }).success,
    ).toBe(true);
  });

  it('refuses mock AI and an in-process database in production', () => {
    const live = {
      AI_PROVIDER: 'live',
      ANTHROPIC_API_KEY: 'a',
      OPENAI_API_KEY: 'b',
    };
    expect(
      envSchema.safeParse({ ...base, NODE_ENV: 'production' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...base, ...live, NODE_ENV: 'production' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...base,
        ...live,
        NODE_ENV: 'production',
        JWT_SECRET: STRONG_SECRET,
        DATABASE_URL: 'postgres://u:p@db:5432/say_again?sslmode=verify-full',
      }).success,
    ).toBe(true);
  });

  const production = {
    AI_PROVIDER: 'live',
    ANTHROPIC_API_KEY: 'a',
    OPENAI_API_KEY: 'b',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://u:p@db:5432/say_again?sslmode=verify-full',
    JWT_SECRET: STRONG_SECRET,
  };
  const problems = (env: object) => {
    const result = envSchema.safeParse(env);
    return result.success ? [] : result.error.issues.map((i) => i.path[0]);
  };

  it('refuses placeholder and test signing secrets in production (KEY-01)', () => {
    expect(problems(production)).toEqual([]);
    for (const secret of [
      'test-only-jwt-secret-of-at-least-32-bytes',
      'change-me-change-me-change-me-change-me',
      'a'.repeat(40),
      'abababababababababababababababababab',
    ]) {
      expect(problems({ ...production, JWT_SECRET: secret })).toEqual([
        'JWT_SECRET',
      ]);
    }
    // Any 32 random bytes pass, as hex too.
    expect(
      problems({ ...production, JWT_SECRET: randomBytes(32).toString('hex') }),
    ).toEqual([]);
  });

  it('needs TLS to the database in production unless it is on localhost (NET-01)', () => {
    const url = (u: string) => problems({ ...production, DATABASE_URL: u });
    expect(url('postgres://u:p@db:5432/say_again')).toEqual(['DATABASE_URL']);
    expect(url('postgres://u:p@db:5432/say_again?sslmode=disable')).toEqual([
      'DATABASE_URL',
    ]);
    expect(url('postgres://u:p@db:5432/say_again?sslmode=require')).toEqual([]);
    expect(url('postgres://u:p@localhost:5432/say_again')).toEqual([]);
  });

  it('does not start live with a model that has no price (RES-01)', () => {
    expect(
      problems({ ...production, COACH_MODEL: 'claude-new-model' }),
    ).toEqual(['COACH_MODEL']);
    expect(problems({ ...production, STT_MODEL: 'gpt-4o-transcribe' })).toEqual(
      [],
    );
  });

  it('treats empty optional values as unset', () => {
    expect(
      envSchema.parse({ ...base, ANTHROPIC_API_KEY: '' }).ANTHROPIC_API_KEY,
    ).toBeUndefined();
  });
});
