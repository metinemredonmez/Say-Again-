import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module.js';
import { ScenariosModule } from './scenarios/scenarios.module.js';

@Module({
  imports: [
    // RES-01: per-IP budget for every route. It is generous because many mobile users share one
    // carrier IP (CGNAT). Per-device and monthly lesson quotas for the AI routes come with the
    // anonymous user in stage 2. The client IP is the socket peer: 'trust proxy' stays off until
    // the hosting proxy is known, so X-Forwarded-For cannot change the budget (NET-03).
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }] }),
    HealthModule,
    ScenariosModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
  ],
})
export class AppModule {}
