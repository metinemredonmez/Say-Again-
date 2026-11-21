import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// LOG-01: every request gets a server-made id, returned as X-Request-Id and written on every
// security event and error log of that request, so one request can be followed end to end.
// A client-sent X-Request-Id is ignored: log fields come from the server, not the client.

export interface RequestContext {
  requestId: string;
  /** The client address as resolved under TRUST_PROXY (NET-03). */
  ip: string | undefined;
  /** The socket peer, kept apart from the resolved address. */
  peer: string | undefined;
  method: string;
  /** Path without the query string. */
  path: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentRequest(): RequestContext | undefined {
  return storage.getStore();
}

export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID();
  res.setHeader('X-Request-Id', requestId);
  storage.run(
    {
      requestId,
      ip: req.ip,
      peer: req.socket.remoteAddress,
      method: req.method,
      path: req.path,
    },
    next,
  );
}
