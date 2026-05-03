import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
  tracesSampleRate: 0.1,
  // Browser session replay — sadece hata olduğunda kaydet (free tier güvenli)
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});
