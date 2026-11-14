'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  bugunMu, denemeAciklamasi, denemeEtiketi, denemeTonu, denemeZamani, uyeMetni, type TestDenemesi, type TestUyesi,
} from '@/lib/test-denemeleri';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';

/**
 * Üye olmadan yapılan AI görünürlük testleri.
 *
 * 14.11.2026, sahip: "üye olmadan tarayan herkesi kaydetmek istiyorum, kaçırmak istemiyorum".
 * Sayfa eskiden yalnız TAZE ölçümleri listeliyordu, bir kez yükleniyordu ve satır marka adıyla
 * başlıyordu (sahip bugünkü testi aynı gün bu sayfada aradı, göremedi). Şimdi:
 *  - "Denemeler": her deneme sonucuyla (ölçüldü, kayıtlı sonucu gördü, sınıra takıldı,
 *    tamamlanamadı) — api audit/public-check-attempt.ts;
 *  - satırlar alan adıyla başlar, bugünküler işaretlidir;
 *  - "Üye oldu": test edilen alan adını sonradan sitesi olarak ekleyen üye (sahip: "kimler
 *    taramış görelim") — eşleşme alan adıyladır;
 *  - sayfa açıkken dakikada bir kendini yeniler; yenileme başarısızsa bunu söyler (eskiden hata
 *    yutulup "kayıt yok" yazıyordu).
 * Deneme listesinde IP özeti GÖSTERİLMEZ ve denemeler ziyaretçiye göre gruplanmaz: gizlilik
 * metni özeti yalnız kötüye kullanım ve test sınırı için ayırıyor (lib/test-denemeleri notu).
 */

const YENILEME_MS = 60_000;

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Ziyaretçi',
  retest_cron: 'Otomatik retest',
  signup_baseline: 'Kayıt baseline',
};

// Turuncu ('default') yalnız birincil eylem içindir (panel kuralı); kaynak etiketi nötr durur.
const SOURCE_VARIANT: Record<string, any> = {
  manual: 'secondary',
  retest_cron: 'outline',
  signup_baseline: 'success',
};

type Lead = {
  id: string; domain: string; brand: string; niche: string | null;
  source: string; ip: string | null; totalCalls: number; costUsd: number;
  createdAt: string; citedScore: number; maxScore: number; queriesCount: number; totalProviders: number;
  member?: TestUyesi | null;
};

type Veri = {
  items: Lead[]; total: number; today: number; uniqueDomains: number;
  attempts?: TestDenemesi[]; attemptsToday?: number; attemptsError?: boolean;
};

function BugunIsareti() {
  return <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">bugün</span>;
}

/** Test edilen alan adını sitesi olarak ekleyen üye — satırın altında tek satır */
function UyeSatiri({ member }: { member?: TestUyesi | null }) {
  const metin = uyeMetni(member);
  if (!member || !metin) return null;
  return (
    <div className="mt-0.5 text-xs text-success" title={`Bu alan adını ${denemeZamani(member.siteAddedAt)} tarihinde sitesi olarak ekledi.`}>
      Üye oldu: {metin}
    </div>
  );
}

export default function AdminLeadsPage() {
  const [data, setData] = useState<Veri | null>(null);
  const [loading, setLoading] = useState(true);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [sonYukleme, setSonYukleme] = useState<Date | null>(null);
  /** Son yükleme denemesi başarısız mı (eski liste ekranda kalır, bayat olduğu söylenir) */
  const [hata, setHata] = useState(false);
  const [q, setQ] = useState('');

  const yukle = useCallback(async () => {
    setYenileniyor(true);
    try {
      setData(await api.getAdminCitationLeads({ limit: 200 }));
      setSonYukleme(new Date());
      setHata(false);
    } catch {
      // Eski liste silinmez; sayfa bunun bayat olduğunu (ya da hiç yüklenemediğini) söyler
      setHata(true);
    } finally {
      setLoading(false);
      setYenileniyor(false);
    }
  }, []);

  useEffect(() => {
    void yukle();
    // Sekme arka plandayken çekilmez (200 ölçüm kaydı boşuna inmesin); öne gelince hemen yenilenir
    const t = setInterval(() => { if (!document.hidden) void yukle(); }, YENILEME_MS);
    const gorunur = () => { if (!document.hidden) void yukle(); };
    document.addEventListener('visibilitychange', gorunur);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', gorunur); };
  }, [yukle]);

  const needle = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    if (!needle) return items;
    return items.filter((l) =>
      (l.domain ?? '').toLowerCase().includes(needle) ||
      (l.brand ?? '').toLowerCase().includes(needle) ||
      (l.niche ?? '').toLowerCase().includes(needle),
    );
  }, [data, needle]);

  const denemeler = useMemo(() => {
    const list = data?.attempts ?? [];
    if (!needle) return list;
    return list.filter((d) =>
      (d.domain ?? '').toLowerCase().includes(needle) ||
      denemeEtiketi(d.outcome).toLowerCase().includes(needle) ||
      uyeMetni(d.member).toLowerCase().includes(needle));
  }, [data, needle]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-[450] tracking-[-0.04em]">AI Test Leadleri</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ana sayfadaki ücretsiz AI görünürlük testini başlatanlar. Yeni ölçümlerde her zaman, diğer denemelerde günlük sınıra kadar e-posta alırsın.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="alan adı, marka ya da sektör ara"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-56 sm:w-64"
          />
          <Button variant="outline" size="sm" onClick={() => void yukle()} disabled={yenileniyor}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', yenileniyor && 'animate-spin')} aria-hidden />Yenile
          </Button>
        </div>
      </div>

      {/* Yükleme hatası: eski liste ekranda kalır ama bayat olduğu söylenir; ilk yüklemede liste yoktur */}
      {hata && (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-4 py-3 text-sm" role="alert">
          {data
            ? `Liste yenilenemedi; gördüğün kayıtlar ${sonYukleme ? sonYukleme.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : 'daha önce'} alındı. Oturumun düşmüş olabilir; “Yenile”ye bas ya da sayfayı yeniden aç.`
            : 'Liste alınamadı. Bu, kayıt olmadığı anlamına gelmez; “Yenile”ye bas ya da sayfayı yeniden aç.'}
        </div>
      )}
      {!hata && data?.attemptsError && (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-4 py-3 text-sm" role="alert">
          Deneme kayıtları okunamadı (ölçüm listesi aşağıda). Sunucu güncellemesi yarım kalmış olabilir.
        </div>
      )}

      {/* Özet istatistik */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6">
          <div className="text-3xl font-[450] tracking-[-0.04em]">{data?.attemptsToday ?? '—'}</div>
          <div className="text-sm text-muted-foreground">Bugünkü deneme</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-3xl font-[450] tracking-[-0.04em]">{data?.today ?? '—'}</div>
          <div className="text-sm text-muted-foreground">Bugünkü yeni ölçüm</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-3xl font-[450] tracking-[-0.04em]">{data?.total ?? '—'}</div>
          <div className="text-sm text-muted-foreground">Toplam ölçüm</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-3xl font-[450] tracking-[-0.04em]">{data?.uniqueDomains ?? '—'}</div>
          <div className="text-sm text-muted-foreground">Farklı alan adı</div>
        </CardContent></Card>
      </div>

      {/* Denemeler — her deneme, sonucuyla */}
      <div className="space-y-2">
        <div>
          <h2 className="text-lg font-medium">Denemeler</h2>
          <p className="text-sm text-muted-foreground">
            Testi başlatan herkes: yeni ölçüm yapılanlar, daha önce ölçülmüş bir alan adının kayıtlı sonucunu görenler, haftalık sınıra takılanlar ve tamamlanamayanlar.
          </p>
        </div>
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !data ? (
              <div className="p-10 text-center text-muted-foreground text-sm">Liste alınamadı.</div>
            ) : denemeler.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">
                {needle
                  ? 'Aramaya uyan deneme yok (arama son 100 denemede yapılır).'
                  : data.attemptsError
                    ? 'Deneme kayıtları okunamadı.'
                    : 'Henüz deneme kaydı yok. Bu kayıt yeni başladı; daha eski testler aşağıdaki ölçüm listesindedir.'}
              </div>
            ) : (
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Alan adı</th>
                    <th className="px-4 py-3 font-medium">Ne oldu</th>
                    <th className="px-4 py-3 font-medium text-right">Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {denemeler.map((d) => (
                    <tr key={d.id} className="border-b last:border-0 align-top hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div>
                          <a href={`https://${d.domain}`} target="_blank" rel="noopener" className="font-medium hover:underline">{d.domain}</a>
                          {bugunMu(d.createdAt) && <BugunIsareti />}
                        </div>
                        <UyeSatiri member={d.member} />
                      </td>
                      <td className="px-4 py-3">
                        <div className={cn('font-medium', denemeTonu(d.outcome))}>{denemeEtiketi(d.outcome)}</div>
                        <div className="mt-0.5 max-w-xl text-xs text-muted-foreground">{d.detail || denemeAciklamasi(d.outcome)}</div>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">{denemeZamani(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ölçümler — yalnız taze ölçüm (sonuçlarıyla) */}
      <div className="space-y-2">
        <div>
          <h2 className="text-lg font-medium">Ölçümler</h2>
          <p className="text-sm text-muted-foreground">Yeni ölçüm yapılan testler ve sonuçları.</p>
        </div>
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : !data ? (
              <div className="p-10 text-center text-muted-foreground text-sm">Liste alınamadı.</div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">{needle ? 'Aramaya uyan ölçüm yok.' : 'Henüz test kaydı yok.'}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Alan adı / Marka</th>
                    <th className="px-4 py-3 font-medium">Sektör</th>
                    <th className="px-4 py-3 font-medium">AI Görünürlük</th>
                    <th className="px-4 py-3 font-medium">Kaynak</th>
                    <th className="px-4 py-3 font-medium">IP</th>
                    <th className="px-4 py-3 font-medium text-right">Maliyet</th>
                    <th className="px-4 py-3 font-medium text-right">Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        {/* Alan adı başta: sahip testi alan adıyla arar; marka (sayfadan tespit) altında */}
                        <div>
                          <a href={`https://${l.domain}`} target="_blank" rel="noopener" className="font-medium hover:underline">{l.domain}</a>
                          {bugunMu(l.createdAt) && <BugunIsareti />}
                        </div>
                        {l.brand && <div className="text-xs text-muted-foreground">{l.brand}</div>}
                        <UyeSatiri member={l.member} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{l.niche ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={l.citedScore > 0 ? 'font-semibold text-success' : 'text-muted-foreground'}>
                          {l.citedScore}/{l.maxScore || '—'}
                        </span>
                        <span className="text-xs text-muted-foreground ml-1">({l.queriesCount} sorgu × {l.totalProviders} motor)</span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={SOURCE_VARIANT[l.source] ?? 'outline'}>{SOURCE_LABEL[l.source] ?? l.source}</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{l.ip ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">${(l.costUsd ?? 0).toFixed(3)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">{denemeZamani(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {data && (
        <p className="text-xs text-muted-foreground text-center">
          {needle
            ? `${denemeler.length} deneme, ${filtered.length} ölçüm gösteriliyor`
            : `Son ${data.attempts?.length ?? 0} deneme ve son ${data.items.length} ölçüm gösteriliyor (toplam ${data.total} ölçüm)`}
          {sonYukleme && !hata && ` · ${sonYukleme.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}’de yenilendi; sayfa açıkken dakikada bir kendiliğinden yenilenir`}
        </p>
      )}
    </div>
  );
}
