import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AuthenticationModule } from '@nestjs/authentication';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountModule } from './account/account.module.js';
import { AuthModule } from './auth/auth.module.js';
import { envSchema, type Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LessonsModule } from './lessons/lessons.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { ScenariosModule } from './scenarios/scenarios.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';

@Module({
  imports: [
    // Settings from the environment (apps/api/.env in development), validated at startup.
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
      cache: true,
    }),
    DatabaseModule,
    // Every route needs a signed-in user unless it is marked @Public().
    AuthenticationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        accessToken: {
          key: config.get('JWT_SECRET', { infer: true }),
          issuer: 'say-again-api',
          audience: 'say-again-app',
          ttl: '15m',
        },
        // Anonymous accounts have no other way back in, so a token family lives long: each
        // refresh token is single use and lasts a year, and reuse revokes the whole family.
        refreshToken: { ttl: '365d', absoluteTtl: '3650d' },
      }),
    }),
    // RES-01: per-IP budget for every route; costly routes set tighter ones. Many mobile users
    // share one carrier IP (CGNAT), so the default is generous; per-user lesson quotas live in
    // the database. The IP is the socket peer unless TRUST_PROXY names the proxy (NET-03).
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      // Test suites register many users from one address; the throttle tests turn it back on.
      // NODE_ENV is validated, and production can never be 'test'.
      skipIf: () =>
        process.env.NODE_ENV === 'test' &&
        process.env.THROTTLE_IN_TESTS !== 'true',
    }),
    HealthModule,
    ScenariosModule,
    AuthModule,
    AccountModule,
    LessonsModule,
    ReviewsModule,
    ReportsModule,
    SubscriptionsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
  ],
})
export class AppModule {}
