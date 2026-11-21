import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Test-only settings: in-process PostgreSQL, mock AI, a throwaway signing secret.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'pglite:memory',
      JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-bytes',
      AI_PROVIDER: 'mock',
      SUBSCRIPTION_PRODUCT_IDS: 'say_again_monthly',
    },

  },
});
