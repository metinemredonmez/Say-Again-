import type { INestApplication } from '@nestjs/common';

// Shared by main.ts and the e2e tests, so the tests run the same HTTP setup as production.
export function configureApp(app: INestApplication): void {
  // Helmet 8 default headers and no X-Powered-By. Called first so every response carries them.
  app.useSecurityHeaders();
  // CORS stays off: the native mobile app does not need it. The admin panel will get an explicit
  // origin list when it is built.
}
