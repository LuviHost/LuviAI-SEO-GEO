import * as Sentry from '@sentry/nextjs';
import { sentryOlayTemizle } from './src/lib/sentry-scrub';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production',
  tracesSampleRate: 0.1,
  // Performans verisinin %10'u kayda geçer (free tier'ı yormaz)
  enabled: !!process.env.SENTRY_DSN,
  // Cerez/govde/kimlik basliklari gonderilmez (gizlilik metni bunu soyler) — bkz. src/lib/sentry-scrub.ts
  sendDefaultPii: false,
  beforeSend: (e) => sentryOlayTemizle(e),
  beforeSendTransaction: (e) => sentryOlayTemizle(e),
});
