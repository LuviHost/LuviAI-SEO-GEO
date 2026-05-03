import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production',
  tracesSampleRate: 0.1,
  // Performans verisinin %10'u kayda geçer (free tier'ı yormaz)
  enabled: !!process.env.SENTRY_DSN,
});
