'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

type Veri = Awaited<ReturnType<typeof api.getAdminSeoAnalyses>>;

const DURUM: Record<string, { ad: string; variant: 'success' | 'secondary' | 'outline' | 'destructive' }> = {
  done: { ad: 'Tamamlandı', variant: 'success' },
  queued: { ad: 'Sırada', variant: 'outline' },
  running: { ad: 'Taranıyor', variant: 'outline' },
  error: { ad: 'Hata', variant: 'destructive' },
};

const zaman = (iso: string) =>
  new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * /admin/leads — ucretsiz SEO analizleri (ranksup.ai/seo-analizi). Sahip 25.11.2026: "denemeler
 * burada gorunsun". Veri api admin.controller GET /admin/seo-analyses; sayfanin arama kutusuna uyar.
 */
export function SeoAnalizleri({ needle, yenile }: { needle: string; yenile: number }) {
  const [data, setData] = useState<Veri | null>(null);
  const [loading, setLoading] = useState(true);
  const [hata, setHata] = useState(false);

  const yukle = useCallback(async () => {
    try { setData(await api.getAdminSeoAnalyses(200)); setHata(false); }
    catch { setHata(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void yukle(); }, [yukle, yenile]);

  const items = (data?.items ?? []).filter((s) => !needle || s.domain.includes(needle) || (s.email ?? '').includes(needle));

  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-lg font-medium">SEO analizleri</h2>
        <p className="text-sm text-muted-foreground">
          ranksup.ai/seo-analizi sayfasından üye olmadan yapılan analizler{data ? ` (toplam ${data.total})` : ''}. Sonucu görmek için e-posta istenir; “Ticari ileti onayı yok” olanlara kampanya e-postası gönderilmez.
          {hata && ' Liste yenilenemedi; gösterilen veri eski olabilir.'}
        </p>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">{needle ? 'Aramaya uyan analiz yok.' : 'Henüz SEO analizi yok.'}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Alan adı</th>
                  <th className="px-4 py-3 font-medium">E-posta</th>
                  <th className="px-4 py-3 font-medium">Durum</th>
                  <th className="px-4 py-3 font-medium">SEO puanı</th>
                  <th className="px-4 py-3 font-medium">Bulgular</th>
                  <th className="px-4 py-3 font-medium">Mobil hız</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium text-right">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <a href={`https://${s.domain}`} target="_blank" rel="noopener" className="font-medium hover:underline">{s.domain}</a>
                      {s.engel && <div className="text-xs text-muted-foreground">Okunamadı: {s.engel}</div>}
                      {s.onbellek && <div className="text-xs text-muted-foreground">Kayıtlı sonuç (yeni tarama yok)</div>}
                    </td>
                    <td className="px-4 py-3">
                      {s.email ? <a href={`mailto:${s.email}`} className="hover:underline">{s.email}</a> : <span className="text-muted-foreground">yazmadı</span>}
                      {s.email && <div className="text-xs text-muted-foreground">{s.pazarlamaIzni ? 'Ticari ileti onayı var' : 'Ticari ileti onayı yok'}</div>}
                    </td>
                    <td className="px-4 py-3"><Badge variant={DURUM[s.status]?.variant ?? 'outline'}>{DURUM[s.status]?.ad ?? s.status}</Badge></td>
                    <td className="px-4 py-3">{s.puan !== null ? <span className="font-semibold">{s.puan}/100</span> : '—'}{s.taranan !== null && <span className="ml-1 text-xs text-muted-foreground">({s.taranan} sayfa)</span>}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.status === 'done' && !s.engel ? `${s.kritik} kritik · ${s.uyari} uyarı` : '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {s.hizPuani !== null ? `${s.hizPuani}/100` : '—'}
                      {s.sahaGecti !== null && <span className="ml-1 text-xs">{s.sahaGecti ? '(gerçek kullanıcı: geçiyor)' : '(gerçek kullanıcı: geçmiyor)'}</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.ip || '—'}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">{zaman(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
