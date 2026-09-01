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

  /**
   * YENI SURUM YAYINLANDI durumu: acik sekme eski HTML'i tutar, o HTML eski JS parcalarini
   * ister; yeni derleme onlari sildigi icin "ChunkLoadError / Loading chunk N failed" gelir.
   * Kullanicinin gordugu sey bir COKME degil, elindeki sayfanin bayatlamasidir — bir kez
   * sessizce yenilemek dogru davranis (01.09.2026: deploy sirasinda gercek kullanicida goruldu).
   *
   * Tek sefer: sessionStorage bayragi sonsuz yenileme dongusunu engeller; ikinci kez olursa
   * normal hata ekrani gosterilir.
   */
  useEffect(() => {
    const bayat = /ChunkLoadError|Loading chunk [\w-]+ failed|Importing a module script failed|Failed to fetch dynamically imported module/i;
    if (!bayat.test(`${error?.name ?? ''} ${error?.message ?? ''}`)) return;
    const ANAHTAR = 'luvi_chunk_reloaded';
    try {
      if (sessionStorage.getItem(ANAHTAR)) return;
      sessionStorage.setItem(ANAHTAR, String(Date.now()));
      window.location.reload();
    } catch {
      /* sessionStorage kapaliysa: yenileme yok, normal hata ekrani kalir */
    }
  }, [error]);

  const yeniSurum = /ChunkLoadError|Loading chunk [\w-]+ failed|dynamically imported module/i.test(
    `${error?.name ?? ''} ${error?.message ?? ''}`,
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background to-muted px-4 py-16">
      <div className="max-w-md text-center">
        <div className="h-20 w-20 mx-auto rounded-full bg-rose-500/10 text-rose-500 grid place-items-center mb-6">
          <AlertTriangle className="h-10 w-10" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          {yeniSurum ? 'Yeni sürüm yayınlandı' : 'Bir şeyler ters gitti'}
        </h1>
        <p className="text-muted-foreground mb-2 leading-relaxed">
          {yeniSurum
            ? 'Bu sekme eski sürümü açık tutuyordu. "Yeniden Dene" ile güncel sürüme geçebilirsin — verilerin etkilenmedi.'
            : 'Beklenmedik bir hata oluştu. Sayfayı yeniden yükleyebilir ya da ana sayfaya dönebilirsin.'}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/70 font-mono mb-2">
            Hata kodu: <code className="bg-muted px-1.5 py-0.5 rounded">{error.digest}</code>
          </p>
        )}
        {error.message && (
          <details className="text-left mb-6 bg-muted/50 rounded-lg p-3 text-xs" open={!yeniSurum}>
            <summary className="cursor-pointer font-semibold text-rose-600 mb-2">Teknik detay</summary>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80">{error.message}</pre>
            {error.stack && (
              <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground mt-2 max-h-48 overflow-y-auto">{error.stack}</pre>
            )}
          </details>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <button
            onClick={() => {
              // NEDEN reload: bayat sekmede React reset'i ayni eski parcalari tekrar ister, hata doner
              if (yeniSurum) {
                try { sessionStorage.removeItem('luvi_chunk_reloaded'); } catch { /* yok say */ }
                window.location.reload();
                return;
              }
              reset();
            }}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-brand text-white font-semibold hover:bg-brand/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" /> {yeniSurum ? 'Güncel sürüme geç' : 'Yeniden Dene'}
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
