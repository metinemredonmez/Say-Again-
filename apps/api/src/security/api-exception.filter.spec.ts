import { Logger, UnauthorizedException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { ApiExceptionFilter } from './api-exception.filter.js';
import type { SecurityEvents } from './security-events.js';

const TRANSCRIPT = 'MY-PRIVATE-TRANSCRIPT I am working here since three years';

function setup() {
  const reply = vi.fn();
  const adapterHost = {
    httpAdapter: { reply, end: vi.fn(), isHeadersSent: () => false },
  } as unknown as HttpAdapterHost;
  const record = vi.fn();
  const events = { record } as unknown as SecurityEvents;
  const host = {
    switchToHttp: () => ({ getResponse: () => ({}) }),
  } as unknown as ArgumentsHost;
  const filter = new ApiExceptionFilter(adapterHost, events);
  return { filter, host, reply, record };
}

describe('ApiExceptionFilter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('answers an unexpected error with a bare 500 and logs no query values (LOG-02, EXC-01)', () => {
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { filter, host, reply } = setup();
    // The shape of a failed Drizzle query: the values are in the message.
    const error = Object.assign(
      new Error(
        `Failed query: insert into "turns" ("text") values ($1)\nparams: ${TRANSCRIPT}`,
      ),
      {
        name: 'DrizzleQueryError',
        cause: { code: '23505', constraint: 'turns_lesson_position_unique' },
      },
    );

    filter.catch(error, host);

    const [, body, status] = reply.mock.calls[0] as [unknown, object, number];
    expect(status).toBe(500);
    expect(body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
      requestId: undefined,
    });
    const entry = JSON.stringify(logged.mock.calls);
    expect(entry).toContain('DrizzleQueryError');
    expect(entry).toContain('23505');
    expect(entry).toContain('turns_lesson_position_unique');
    expect(entry).not.toContain('MY-PRIVATE-TRANSCRIPT');
    expect(entry).not.toContain('params');
  });

  it('keeps HTTP errors as they are and records refused authentication (LOG-01)', () => {
    const { filter, host, reply, record } = setup();
    filter.catch(new UnauthorizedException(), host);
    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      { statusCode: 401, message: 'Unauthorized' },
      401,
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.denied', outcome: 'deny' }),
    );
  });

  it('passes body-parser client errors through (bad JSON is a 400, not a 500)', () => {
    const { filter, host, reply } = setup();
    const error = Object.assign(new SyntaxError('Unexpected token'), {
      statusCode: 400,
      expose: true,
    });
    filter.catch(error, host);
    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      { statusCode: 400, message: 'Unexpected token' },
      400,
    );
  });
});
