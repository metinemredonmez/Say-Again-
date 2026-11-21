import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

async function bootstrap() {
  // LOG-01: one JSON object per line in production, for the log platform to index.
  const app = await NestFactory.create(
    AppModule,
    process.env.NODE_ENV === 'production'
      ? { logger: new ConsoleLogger({ json: true }) }
      : {},
  );
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
