import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Test-only settings: in-process PostgreSQL, mock AI, a throwaway signing secret.
    env: {
      NODE_ENV: 'test',
      // CI also runs the suite on a real PostgreSQL server through TEST_DATABASE_URL.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'pglite:memory',
      JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-bytes',
      AI_PROVIDER: 'mock',
      SUBSCRIPTION_PRODUCT_IDS: 'say_again_monthly',
    },
    testTimeout: 30_000,
  },
});
