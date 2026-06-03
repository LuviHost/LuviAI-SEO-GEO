import 'dotenv/config';

// IPv4 once DNS resolution — sunucuda IPv6 calismadigi icin happy-eyeballs IPv6'yi
// once denerse "request to oauth2.googleapis.com failed" hatasi verir (googleapis,
// gaxios, vb. libraries undici'den bagimsiz Node DNS kullanir).
import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

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

// IPv4'e zorla (sunucularda public IPv6 yoksa Node fetch ETIMEDOUT verir).
// ESM uyumlu top-level import — eski require() versiyonu ESNext modunda silently fail ediyordu.
import { setGlobalDispatcher as undiciSetGlobalDispatcher, Agent as UndiciAgent } from 'undici';
undiciSetGlobalDispatcher(new UndiciAgent({
  connect: { family: 4 } as any,
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
}));

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
  console.log(`🚀 RanksUp API listening on http://localhost:${port}`);
}

bootstrap();
