'use client';

import { useEffect, useState } from 'react';
import {
  sessizYenile, sessizYenilemeBekleniyor, yuklemeHatasiMetni, yuklemeHatasiTuru,
} from '@/lib/yukleme-hatasi';

/**
 * Kok hata ekrani: kok duzenin kendisi cizilemediginde butun belgenin yerine gecer.
 * Site stilleri burada garanti degildir; o yuzden satir ici stil ve sistem yazi tipi.
 *
 * 13.11.2026: mobil baglantida sayfa yarida kesilince bu ekran cikiyor ("Connection closed."),
 * "Yeniden Dene" de eksik inen sayfayi yeniden cizdigi icin hicbir seyi duzeltmiyordu.
 * Artik: yarim yukleme ve bayat surum bir kez sessizce yeniden yuklenir
 * (lib/yukleme-hatasi.ts); dugme her durumda sayfayi sunucudan yeniden indirir; hatanin
 * metni "Teknik detay" altinda gorunur (ekran goruntusunden teshis edilebilsin).
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  const metin = yuklemeHatasiMetni(yuklemeHatasiTuru(error));
  const [yenileniyor, setYenileniyor] = useState(() => sessizYenilemeBekleniyor(error));
  useEffect(() => {
    setYenileniyor(sessizYenile(error));
  }, [error]);

  const govde = { margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#090909', color: '#fff', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;

  // Sessiz yenileme yoldayken hata ekrani bir an bile gorunmesin
  if (yenileniyor) {
    return (
      <html lang="tr">
        <body style={govde}>
          <p role="status" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.875rem' }}>Sayfa yeniden yükleniyor…</p>
        </body>
      </html>
    );
  }

  return (
    <html lang="tr">
      <body style={govde}>
        <div style={{ maxWidth: 480, padding: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>⚠️</div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>{metin?.baslik ?? 'Beklenmedik bir hata'}</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '2rem', lineHeight: 1.6 }}>
            {metin?.aciklama ?? 'Uygulama yüklenemedi. Sayfayı yeniden yüklemeyi dene.'}{' '}
            Sorun devam ederse{' '}
            <a href="mailto:destek@luvihost.com" style={{ color: '#fff' }}>
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
            onClick={() => window.location.reload()}
            style={{ padding: '0.75rem 1.5rem', background: '#FF5800', color: '#000', border: 0, borderRadius: 6, fontWeight: 600, fontSize: '1rem', cursor: 'pointer' }}
          >
            {metin?.dugme ?? 'Sayfayı yeniden yükle'}
          </button>
          {error.message && (
            <details style={{ marginTop: '2rem', textAlign: 'left', fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>
              <summary style={{ cursor: 'pointer', textAlign: 'center' }}>Teknik detay</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, monospace', marginTop: '0.75rem' }}>{error.message}</pre>
            </details>
          )}
        </div>
      </body>
    </html>
  );
}
