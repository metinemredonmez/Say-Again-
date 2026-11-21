import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';
import { currentRequest } from './request-context.js';
import { SecurityEvents } from './security-events.js';

// Every error answer goes through here.
//  - EXC-01: an unexpected error is a plain 500 with the request id and nothing else.
//  - LOG-02: Nest's default handler logs the whole error, and a failed query's message carries
//    its parameters (learner transcripts, notes). This logs the error class, the database error
//    code and constraint, and the stack frames without the message line.
//  - LOG-01: refused authentication (401), refused access (403) and rate limits (429) become
//    security events.

interface DatabaseError {
  code?: string;
  constraint?: string;
  table?: string;
}

/** body-parser and other http-errors errors: 400 bad JSON, 413 too large. */
function isClientHttpError(
  error: unknown,
): error is { statusCode: number; expose: boolean; message: string } {
  const e = error as { statusCode?: unknown; expose?: unknown };
  return (
    typeof e?.statusCode === 'number' &&
    e.expose === true &&
    e.statusCode >= 400 &&
    e.statusCode < 500
  );
}

/** The stack's frame lines only: a message can span lines, and its values must not leak. */
function framesOnly(stack: string | undefined): string | undefined {
  return stack
    ?.split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly events: SecurityEvents,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const response = host.switchToHttp().getResponse<unknown>();
    const reply = (body: unknown, status: number) => {
      if (httpAdapter.isHeadersSent(response)) {
        httpAdapter.end(response);
      } else {
        httpAdapter.reply(response, body, status);
      }
    };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      this.securityEvent(exception, status);
      const body = exception.getResponse();
      reply(
        typeof body === 'object' ? body : { statusCode: status, message: body },
        status,
      );
      return;
    }

    if (isClientHttpError(exception)) {
      reply(
        { statusCode: exception.statusCode, message: exception.message },
        exception.statusCode,
      );
      return;
    }

    const error = exception as Error & { cause?: DatabaseError };
    const database: DatabaseError =
      error?.cause ?? (exception as DatabaseError) ?? {};
    const requestId = currentRequest()?.requestId;
    this.logger.error({
      message: 'Unhandled error',
      error: error?.name ?? typeof exception,
      ...(database.code ? { dbCode: database.code } : {}),
      ...(database.constraint ? { dbConstraint: database.constraint } : {}),
      ...(database.table ? { dbTable: database.table } : {}),
      requestId,
      stack: framesOnly(error?.stack),
    });
    reply(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        requestId,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private securityEvent(exception: HttpException, status: number): void {
    const route = currentRequest()?.path;
    if (status === 401) {
      this.events.record({
        event: 'auth.denied',
        outcome: 'deny',
        object: route,
      });
    } else if (status === 403) {
      this.events.record({
        event: 'access.forbidden',
        outcome: 'deny',
        object: route,
      });
    } else if (exception instanceof ThrottlerException) {
      this.events.record({
        event: 'rate_limited',
        outcome: 'deny',
        object: route,
      });
    }
  }
}
