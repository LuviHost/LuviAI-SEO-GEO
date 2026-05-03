'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="tr">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0c0a14', color: '#fff', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 480, padding: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>⚠️</div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>Beklenmedik bir hata</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '2rem', lineHeight: 1.6 }}>
            Uygulama yüklenemedi. Sayfayı yeniden yüklemeyi dene; sorun devam ederse{' '}
            <a href="mailto:destek@luvihost.com" style={{ color: '#a78bfa' }}>
              destek@luvihost.com
            </a>{' '}
            adresine yazabilirsin.
          </p>
          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', marginBottom: '2rem' }}>
              {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{ padding: '0.75rem 1.5rem', background: '#7c3aed', color: '#fff', border: 0, borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
          >
            Yeniden Dene
          </button>
        </div>
      </body>
    </html>
  );
}
