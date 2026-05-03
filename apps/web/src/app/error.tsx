'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry'ye otomatik gider (Sentry SDK varsa)
    console.error('App error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background to-muted px-4 py-16">
      <div className="max-w-md text-center">
        <div className="h-20 w-20 mx-auto rounded-full bg-rose-500/10 text-rose-500 grid place-items-center mb-6">
          <AlertTriangle className="h-10 w-10" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          Bir şeyler ters gitti
        </h1>
        <p className="text-muted-foreground mb-2 leading-relaxed">
          Beklenmedik bir hata oluştu. Sayfayı yeniden yükleyebilir ya da ana sayfaya dönebilirsin.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/70 font-mono mb-6">
            Hata kodu: <code className="bg-muted px-1.5 py-0.5 rounded">{error.digest}</code>
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-brand text-white font-semibold hover:bg-brand/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" /> Yeniden Dene
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md border bg-background hover:bg-muted transition-colors text-sm font-medium"
          >
            <Home className="h-4 w-4" /> Ana Sayfa
          </Link>
        </div>

        <p className="text-xs text-muted-foreground mt-8">
          Sorun devam ederse{' '}
          <a href="mailto:destek@luvihost.com" className="text-brand hover:underline">
            destek@luvihost.com
          </a>{' '}
          adresine yazabilirsin.
        </p>
      </div>
    </div>
  );
}
