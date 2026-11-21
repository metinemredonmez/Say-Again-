import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { requestContext } from './security/request-context.js';

// Shared by main.ts and the e2e tests, so the tests run the same HTTP setup as production.
export function configureApp(app: INestApplication): void {
  // Helmet 8 default headers and no X-Powered-By. Called first so every response carries them.
  app.useSecurityHeaders();

  // NET-03: trust X-Forwarded-For only from the named proxy; without it the client IP is the
  // socket peer, so a client cannot pick its own rate-limit bucket.
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) {
    const hops = Number(trustProxy);
    (app as NestExpressApplication).set(
      'trust proxy',
      Number.isInteger(hops) ? hops : trustProxy,
    );
  }

  // LOG-01: a request id and the resolved client address for every log entry of the request.
  // After trust proxy, so the address is resolved the same way as for rate limits.
  app.use(requestContext);

  // CORS stays off: the native mobile app does not need it. The admin panel will get an explicit
  // origin list when it is built.
}
