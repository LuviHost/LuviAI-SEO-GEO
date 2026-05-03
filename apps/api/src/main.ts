import 'dotenv/config';

// Sentry — error tracking. En basta init edilmeli ki sonraki cagrilari yakalasin.
import * as Sentry from '@sentry/node';
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
    tracesSampleRate: 0.1,
    integrations: [Sentry.httpIntegration(), Sentry.consoleIntegration()],
  });
}

// IPv4'e zorla (sunucularda public IPv6 yoksa Node fetch ETIMEDOUT verir)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undici = require('undici') as { setGlobalDispatcher: (d: unknown) => void; Agent: new (opts: unknown) => unknown };
  undici.setGlobalDispatcher(new undici.Agent({ connect: { family: 4 } }));
} catch {
  // older Node — sessizce geç
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Catch, ArgumentsHost, ExceptionFilter, HttpException } from '@nestjs/common';
import { AppModule } from './app.module.js';

@Catch()
class SentryExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // Sadece beklenmedik (5xx) hatalar Sentry'e gitsin; client error (4xx) gurultu yapmasin
    const isHttpError = exception instanceof HttpException;
    const status = isHttpError ? (exception as HttpException).getStatus() : 500;
    if (!isHttpError || status >= 500) {
      Sentry.captureException(exception);
    }

    // Standart NestJS davranisina geri don
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const message = isHttpError
      ? (exception as HttpException).getResponse()
      : { statusCode: 500, message: 'Internal server error' };
    response.status(status).json(typeof message === 'string' ? { message } : message);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.setGlobalPrefix('api');

  // Sentry global exception filter
  app.useGlobalFilters(new SentryExceptionFilter());

  const port = parseInt(process.env.API_PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`🚀 LuviAI API listening on http://localhost:${port}`);
}

bootstrap();
