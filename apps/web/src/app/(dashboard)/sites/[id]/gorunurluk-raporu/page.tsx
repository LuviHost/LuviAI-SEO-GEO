'use client';

/**
 * GEO Karşılaştırma Raporu — iki AI görünürlük koşumunun A4 yazdırılabilir raporu.
 *
 * NEDEN ayrı sayfa (window.open ile doğrudan API değil): rapor ucu oturum ister; yeni sekmede
 * açılan ham API adresi popup engelleyicisine takılabiliyor ve hata sayfası gibi görünüyordu
 * (01.09.2026 kullanıcı bildirimi). Burada rapor oturumlu fetch ile alınır, izole iframe'de
 * gösterilir; yazdırma iframe'in kendi içeriğinden yapılır (sayfa çerçevesi kâğıda girmez).
 */

import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { siteHref } from '@/lib/site-routes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Printer, RefreshCw, AlertTriangle, FileBarChart } from 'lucide-react';

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
    if (!siteId || !a || !b) return; // seçim yok → yönlendiren boş durum gösterilir
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
      <div className="flex items-center gap-2 bg-background pb-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="v-rail inline-flex items-center gap-1.5 transition-colors duration-200 hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Geri
        </button>
        <div className="ml-2 text-panel-3">GEO Karşılaştırma Raporu</div>
        {html && (
          <Button type="button" size="sm" onClick={yazdir} className="ml-auto">
            <Printer className="h-4 w-4" /> Yazdır / PDF
          </Button>
        )}
      </div>

      {!a || !b ? (
        <div className="flex-1 pt-2">
          <EmptyState
            icon={FileBarChart}
            title="Karşılaştırılacak iki ölçüm seç"
            description="Rapor iki AI görünürlük ölçümünü yan yana koyar. AI Görünürlük sayfasındaki test geçmişinden ikisini seçip “Karşılaştır” dediğinde burada açılır."
            primary={{ label: 'AI Görünürlük’e git', href: siteHref(String(siteId ?? ''), 'visibility') }}
          />
        </div>
      ) : hata ? (
        <div className="flex-1 grid place-items-center p-8 text-center">
          <div className="max-w-sm">
            <span className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-md border border-danger/30 bg-danger/5 text-danger" aria-hidden>
              <AlertTriangle className="h-5 w-5" />
            </span>
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
          className="w-full flex-1 rounded-lg border border-border bg-white"
          sandbox="allow-same-origin allow-modals allow-popups"
        />
      )}
    </div>
  );
}
