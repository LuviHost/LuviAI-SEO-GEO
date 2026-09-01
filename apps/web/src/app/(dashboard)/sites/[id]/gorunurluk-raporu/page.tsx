'use client';

/**
 * GEO Karşılaştırma Raporu — iki AI görünürlük koşumunun A4 yazdırılabilir raporu.
 *
 * NEDEN ayrı sayfa (window.open ile doğrudan API değil): rapor ucu oturum ister; yeni sekmede
 * açılan ham API adresi popup engelleyicisine takılabiliyor ve hata sayfası gibi görünüyordu
 * (01.09.2026 kullanıcı bildirimi). Burada rapor oturumlu fetch ile alınır, izole iframe'de
 * gösterilir; yazdırma iframe'in kendi içeriğinden yapılır (sayfa çerçevesi kâğıda girmez).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Printer, RefreshCw, AlertTriangle } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function GorunurlukRaporuPage() {
  const params = useParams<{ id: string }>();
  const arama = useSearchParams();
  const router = useRouter();
  const cerceve = useRef<HTMLIFrameElement>(null);

  const siteId = params?.id;
  const a = arama.get('a');
  const b = arama.get('b');

  const [html, setHtml] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    let iptal = false;
    if (!siteId || !a || !b) {
      setHata('Karşılaştırılacak iki koşum seçilmedi.');
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/sites/${encodeURIComponent(siteId)}/audit/citation-runs/rapor?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
          { credentials: 'include' },
        );
        if (!res.ok) throw new Error(res.status === 401 ? 'Oturumun düşmüş olabilir — yeniden giriş yap.' : `Rapor alınamadı (${res.status})`);
        const metin = await res.text();
        if (!iptal) setHtml(metin);
      } catch (err) {
        if (!iptal) setHata((err as Error)?.message ?? 'Rapor alınamadı');
      }
    })();
    return () => { iptal = true; };
  }, [siteId, a, b]);

  const yazdir = useCallback(() => {
    // NEDEN iframe'den: sayfa başlığı/menüsü kâğıda girmesin, rapor kendi @page kurallarıyla bassın
    const pencere = cerceve.current?.contentWindow;
    if (!pencere) return;
    pencere.focus();
    pencere.print();
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Geri
        </button>
        <div className="text-sm font-medium ml-2">GEO Karşılaştırma Raporu</div>
        <button
          type="button"
          onClick={yazdir}
          disabled={!html}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          <Printer className="h-4 w-4" /> Yazdır / PDF
        </button>
      </div>

      {hata ? (
        <div className="flex-1 grid place-items-center p-8 text-center">
          <div className="max-w-sm">
            <AlertTriangle className="h-8 w-8 text-rose-500 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{hata}</p>
          </div>
        </div>
      ) : !html ? (
        <div className="flex-1 grid place-items-center">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" /> Rapor hazırlanıyor…
          </div>
        </div>
      ) : (
        <iframe
          ref={cerceve}
          title="GEO Karşılaştırma Raporu"
          srcDoc={html}
          className="flex-1 w-full border-0 bg-white"
          sandbox="allow-same-origin allow-modals allow-popups"
        />
      )}
    </div>
  );
}
