'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import {
  sessizYenile, sessizYenilemeBekleniyor, yuklemeHatasiMetni, yuklemeHatasiTuru,
} from '@/lib/yukleme-hatasi';

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
   * Bayat sekme ("yeni surum yayinlandi") ve yarida kesilen yukleme ("Connection closed."):
   * ikisi de cokme degil, tarayicinin elindeki sayfanin eksik olmasidir; bir kez sessizce
   * yeniden yuklemek dogru davranis (lib/yukleme-hatasi.ts). Yenilenen sayfa da ayni hatayi
   * verirse ikinci yenileme yapilmaz, asagidaki ekran gosterilir.
   */
  const tur = yuklemeHatasiTuru(error);
  const metin = yuklemeHatasiMetni(tur);
  const [yenileniyor, setYenileniyor] = useState(() => sessizYenilemeBekleniyor(error));
  useEffect(() => {
    setYenileniyor(sessizYenile(error));
  }, [error]);

  // Sessiz yenileme yoldayken hata ekrani bir an bile gorunmesin
  if (yenileniyor) {
    return (
      <div className="min-h-screen grid place-items-center px-4 text-sm text-muted-foreground" role="status">
        Sayfa yeniden yükleniyor…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background to-muted px-4 py-16">
      <div className="max-w-md text-center">
        <div className="h-20 w-20 mx-auto rounded-full bg-rose-500/10 text-rose-500 grid place-items-center mb-6">
          <AlertTriangle className="h-10 w-10" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          {metin?.baslik ?? 'Bir şeyler ters gitti'}
        </h1>
        <p className="text-muted-foreground mb-2 leading-relaxed">
          {metin?.aciklama ?? 'Beklenmedik bir hata oluştu. Sayfayı yeniden yükleyebilir ya da ana sayfaya dönebilirsin.'}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/70 font-mono mb-2">
            Hata kodu: <code className="bg-muted px-1.5 py-0.5 rounded">{error.digest}</code>
          </p>
        )}
        {error.message && (
          <details className="text-left mb-6 bg-muted/50 rounded-lg p-3 text-xs" open={!tur}>
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
              // NEDEN reload: bayat ya da yarim inmis sayfada React reset'i ayni eksik veriyi
              // yeniden cizer, hata doner; sayfa sunucudan yeniden indirilmeli
              if (tur) {
                window.location.reload();
                return;
              }
              reset();
            }}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-brand text-white font-semibold hover:bg-brand/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" /> {metin?.dugme ?? 'Yeniden Dene'}
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
