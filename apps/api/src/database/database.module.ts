import { fileURLToPath } from 'node:url';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Env } from '../config/env.js';
import type { Database } from './database.js';

// apps/api/drizzle, from src/database and from dist/database alike.
const migrationsFolder = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Env, true>) => {
        const url = config.get('DATABASE_URL', { infer: true });
        const nodeEnv = config.get('NODE_ENV', { infer: true });
        // Several instances starting at once would race on migrations, so production runs
        // `npm run db:migrate` as a release step unless DATABASE_MIGRATE=true.
        const migrateOnStart =
          config.get('DATABASE_MIGRATE', { infer: true }) ??
          nodeEnv !== 'production';

        if (url.startsWith('pglite:')) {
          // In-process PostgreSQL for tests and local work; refused in production by env.ts.
          const { PGlite } = await import('@electric-sql/pglite');
          const pglite = await import('drizzle-orm/pglite');
          const pgliteMigrator = await import('drizzle-orm/pglite/migrator');
          const where = url.slice('pglite:'.length);
          const client = where === 'memory' ? new PGlite() : new PGlite(where);
          const db = pglite.drizzle({ client });
          if (migrateOnStart) {
            await pgliteMigrator.migrate(db, { migrationsFolder });
          }
          return { db: db as unknown as Database };
        }

        const db = drizzle({ connection: { connectionString: url, max: 10 } });
        if (migrateOnStart) {
          new Logger('Database').log('Applying migrations');
          await migrate(db, { migrationsFolder });
        }
        return { db };
      },
    }),
  ],
})
export class DatabaseModule {}
