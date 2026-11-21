import { defineConfig } from 'drizzle-kit';

// npm run db:generate writes a migration from src/database/schema.ts;
// npm run db:migrate applies pending migrations to DATABASE_URL.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
