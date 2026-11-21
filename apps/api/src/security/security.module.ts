import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { SecurityEvents } from './security-events.js';

// Security events and the error filter, for every module (LOG-01, LOG-02, EXC-01).
@Global()
@Module({
  providers: [
    SecurityEvents,
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
  exports: [SecurityEvents],
})
export class SecurityModule {}
