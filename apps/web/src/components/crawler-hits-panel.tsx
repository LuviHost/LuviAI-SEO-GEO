'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Bot, Upload, RefreshCw, Sparkle, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { buildBotRows, ingestNotices, normalizeCounts, sourceLabel, unknownText, unverifiedText } from '@/lib/crawler-verification';
import { CHART } from '@/lib/chart-colors';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Yuklenebilecek en buyuk log (bayt). Sunucudaki CrawlerIngestDto
 * @MaxLength(1_000_000) karakter siniriyla ayni: file.text() UTF-8 cozer ve
 * karakter sayisi bayt sayisini asamaz, yani bu kontrolu gecen dosya DTO'yu da
 * gecer. Duz metin log JSON'a kacislanirken en fazla ~2 katina cikar (", \ ve
 * satir sonu iki bayt olur; ~2.000.000 bayt) ve API'nin 2 MiB govde sinirinin
 * (apps/api/src/request-body.ts) altinda kalir. Ikili ya da bozuk dosya bunu
 * asarsa sunucu 413 ve Turkce boyut mesaji doner. Eskiden kontrol yoktu:
 * buyuk dosya sunucuya gidip genel bir hatayla donuyordu, musteri nedenini
 * goremiyordu.
 */
const MAX_LOG_BYTES = 1_000_000;

// Bot kategorisi bir VERI serisidir: renk grafik paletinden (lib/chart-colors.ts), sinif adindan degil.
// Amac dagilimi cubugu da ayni eslesmeyi kullanir (eskiden iki yerde farkli renklerdi).
const CATEGORY_COLOR: Record<string, string> = {
  'ai-search': CHART[3],
  'training': CHART[4],
  'classic-search': CHART[2],
  'social': CHART[5],
};
const CATEGORY_FALLBACK = CHART[8];

/** ui/metric MetricCard ile ayni kutu (durum ikonu etiketin solunda kaldigi icin elle) */
const TILE = 'rounded-lg border bg-card p-4';
const TILE_VALUE = 'mt-3 text-metric-lg tabular-nums';
const TILE_HINT = 'mt-2 text-label font-normal text-muted-foreground/80';

/**
 * AI Crawler Hits Panel — sunucu logundan AI bot trafigini gosterir.
 * Kullanici Apache/nginx access.log icerigini upload eder, parse + DB'ye yaz,
 * 30 gunluk bot dagilimi grafigi cizilir.
 */
export function CrawlerHitsPanel({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getCrawlerHistory(siteId, 30);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [siteId]);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOG_BYTES) {
      toast.error('Log dosyası çok büyük (en fazla 1 MB). Daha kısa bir döneme ait ya da son satırlarıyla kısaltılmış bir log dosyası yükleyin.');
      // Ayni dosya (kisaltilip) yeniden secilebilsin diye secim temizlenir
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      const text = await file.text();
      const res = await api.ingestCrawlerLog(siteId, text);
      toast.success(`${res.entries} satır parse edildi · ${res.bots} bot · ${res.saved} snapshot`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (loading || !data) {
    return <div className="text-sm text-muted-foreground p-6 text-center">Crawler analytics yükleniyor…</div>;
  }

  // totalHits = UA'si bot olan TUM istekler; manset IP'si dogrulanmis ziyaret
  // (api crawler-analytics getHistory verification, bot-verification.ts)
  const totalHits = data.totalHits ?? 0;
  const verification = normalizeCounts(data.verification, totalHits);
  const byCategory = data.byCategoryVerified ?? {};
  const firstSeen: Record<string, string> = data.firstSeen ?? {};
  const botRows = buildBotRows(data.byBot, data.byBotVerification, data.registry);
  const notices = ingestNotices(data.ingestHealth);
  const lastEventAt: string | null = data.ingestHealth?.lastEventAt ?? null;

  // 7 gün içinde ilk görülen bot'lar (alarm bandı için)
  const NEW_THRESHOLD_DAYS = 7;
  const newBotIds = Object.entries(firstSeen)
    .filter(([, iso]) => Date.now() - new Date(iso).getTime() < NEW_THRESHOLD_DAYS * 86400000)
    .map(([bot]) => bot);
  const newBotLabels = newBotIds
    .map((bot) => data.registry?.[bot]?.label ?? bot)
    .slice(0, 4);
  const isNew = (bot: string) => newBotIds.includes(bot);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-panel-3 inline-flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" /> AI Crawler Trafiği
            </p>
            {/* Google-Extended yazilmaz: ayri bir HTTP kullanici ajani yok, yalniz robots.txt
                belirteci — sunucu logunda hic gorunmez
                (https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers) */}
            <p className="text-sm text-muted-foreground mt-0.5">
              GPTBot · OAI-SearchBot · ClaudeBot · PerplexityBot sitenizi taradı mı?
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex h-9 items-center gap-2 rounded-md border border-foreground/20 px-3 text-sm font-medium cursor-pointer transition-colors duration-200 hover:border-foreground/70 focus-within:ring-2 focus-within:ring-ring">
              <Upload className="h-3.5 w-3.5" />
              {uploading ? 'Yükleniyor…' : 'Log Upload'}
              <input type="file" accept=".log,.txt" className="hidden" onChange={onFileChange} disabled={uploading} />
            </label>
            <Button size="sm" variant="outline" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Yenile
            </Button>
          </div>
        </div>

        {totalHits === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            <p className="mb-2">Henüz crawler verisi yok.</p>
            <p className="text-xs">
              Sunucunuzun <code className="bg-muted px-1 rounded">access.log</code> dosyasını "Log Upload" butonu ile yükleyin
              (cPanel'de <code className="bg-muted px-1 rounded">~/access-logs/&lt;domain&gt;</code>).
              Apache combined format desteklenir.
            </p>
          </div>
        ) : (
          <>
            {/* İlk ziyaret alarmı */}
            {newBotIds.length > 0 && (
              <div className="rounded-lg border border-success/25 bg-success/5 p-4 flex items-start gap-3 [&_strong]:font-medium">
                <Sparkle className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                <div className="flex-1">
                  <p className="font-medium">
                    {newBotIds.length === 1 ? 'Yeni AI bot ziyareti!' : `${newBotIds.length} yeni AI bot ziyareti!`}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1 [&_strong]:text-foreground">
                    Son {NEW_THRESHOLD_DAYS} gün içinde sitenizi <strong>ilk kez</strong> taramaya başladılar:{' '}
                    <span className="font-medium text-foreground">{newBotLabels.join(', ')}</span>
                    {newBotIds.length > newBotLabels.length && ` ve ${newBotIds.length - newBotLabels.length} bot daha`}.
                  </p>
                </div>
              </div>
            )}

            {/* Kaynak sagligi: eski kod IP gondermiyor / 429 ile dusen istek */}
            {notices.codeUpdate && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 flex items-start gap-3 text-sm">
                <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" aria-hidden />
                <p>
                  {notices.codeUpdate}{' '}
                  <Link href={`/sites/${siteId}/crawler-live`} className="font-medium underline underline-offset-4">Kurulum kodunu aç</Link>
                </p>
              </div>
            )}
            {notices.throttled && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 flex items-start gap-3 text-sm">
                <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" aria-hidden />
                <p>{notices.throttled}</p>
              </div>
            )}

            {/* Manset: dogrulanmis ziyaret; taklit olabilecekler ve dogrulanamayanlar ayri */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className={TILE}>
                <p className="v-rail flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden /> Doğrulanmış bot ziyareti
                </p>
                <p className={TILE_VALUE}>{verification.verified.toLocaleString('tr-TR')}</p>
                <p className={TILE_HINT}>IP adresi sağlayıcının resmi listesinde (son 30 gün)</p>
              </div>
              <div className={TILE}>
                <p className="v-rail flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden /> Taklit olabilir
                </p>
                <p className={TILE_VALUE}>{verification.unverified.toLocaleString('tr-TR')}</p>
                <p className={TILE_HINT}>Kendini AI botu olarak tanıtıyor, IP adresi sağlayıcıya ait değil</p>
              </div>
              <div className={TILE}>
                <p className="v-rail">Doğrulanamadı</p>
                <p className={TILE_VALUE}>{verification.unknown.toLocaleString('tr-TR')}</p>
                <p className={TILE_HINT}>
                  IP bilgisi yok (eski kurulum kodu ya da eski kayıt) veya bot resmi liste yayımlamıyor
                </p>
              </div>
            </div>
            <p className="text-label font-normal text-muted-foreground">
              Toplam {totalHits.toLocaleString('tr-TR')} istek AI botu kullanıcı ajanı taşıyordu; yalnızca IP adresi doğrulananlar
              gerçek bot ziyareti sayılır.
              {lastEventAt && <> Son kayıt: {new Date(lastEventAt).toLocaleString('tr-TR')} ({sourceLabel(data.ingestHealth?.lastEventSource)}).</>}
            </p>

            {verification.verified > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(byCategory).map(([cat, count]) => (
                  <div key={cat} className={TILE}>
                    <p className="v-rail flex items-center gap-1.5 capitalize">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[cat] ?? CATEGORY_FALLBACK }} aria-hidden />
                      {cat.replace('-', ' ')} · doğrulanmış
                    </p>
                    <p className="mt-3 text-metric tabular-nums">{(count as number).toLocaleString('tr-TR')}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Clarity-style: Bot purpose split + Pages crawled coverage */}
            {(data.purposeSplit || data.coverage) && (
              <div className="grid md:grid-cols-2 gap-3 [&_strong]:font-medium [&_strong]:text-foreground">
                {/* Purpose split bar — dogrulanmis ziyaretlerden (taklit UA dagilimi bozmasin) */}
                {data.purposeSplit && verification.verified > 0 && (
                  <div className={TILE}>
                    <p className="v-rail mb-3">Bot Amaç Dağılımı <span>(doğrulanmış ziyaretler)</span></p>
                    <div className="flex h-2 rounded-full overflow-hidden bg-muted mb-3">
                      <div style={{ width: `${data.purposeSplit.aiSearchPct}%`, backgroundColor: CATEGORY_COLOR['ai-search'] }} title={`AI Search %${data.purposeSplit.aiSearchPct}`} />
                      <div style={{ width: `${data.purposeSplit.trainingPct}%`, backgroundColor: CATEGORY_COLOR['training'] }} title={`Training %${data.purposeSplit.trainingPct}`} />
                      <div style={{ width: `${data.purposeSplit.classicSearchPct}%`, backgroundColor: CATEGORY_COLOR['classic-search'] }} title={`Classic %${data.purposeSplit.classicSearchPct}`} />
                      <div style={{ width: `${data.purposeSplit.otherPct}%`, backgroundColor: CATEGORY_FALLBACK }} />
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-label font-normal text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORY_COLOR['ai-search'] }} />AI Search %{data.purposeSplit.aiSearchPct}</span>
                      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORY_COLOR['training'] }} />Training %{data.purposeSplit.trainingPct}</span>
                      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORY_COLOR['classic-search'] }} />Classic %{data.purposeSplit.classicSearchPct}</span>
                    </div>
                  </div>
                )}
                {/* Page coverage */}
                {data.coverage && (
                  <div className={TILE}>
                    <p className="v-rail mb-3">Sayfa Tarama Kapsamı</p>
                    {/* Oran = site haritasindaki sayfalardan EN AZ BIR bot ziyareti gorenler /
                        site haritasindaki sayfalar (crawler-analytics.service.ts computeCoverage).
                        Eskiden pay botlarin istedigi tum tekil yollardi (robots.txt, feed,
                        wp-json dahil) ve %100'de kirpiliyordu. Liste okunamazsa oran yok; nedeni
                        API'den gelir. partial: ziyaret listesi eksik, oran alt sinir. */}
                    {typeof data.coverage.pagesCrawledPct === 'number' && typeof data.coverage.sitePagesTotal === 'number' && data.coverage.sitePagesTotal > 0 ? (
                      <>
                        <div className="flex items-baseline gap-2 mb-2">
                          <span className="text-metric-lg tabular-nums">
                            {data.coverage.partial ? 'en az ' : ''}%{data.coverage.pagesCrawledPct}
                          </span>
                          <span className="text-label font-normal text-muted-foreground">ziyaret edildi</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-2">
                          <div className="h-full rounded-full bg-foreground" style={{ width: `${data.coverage.pagesCrawledPct}%` }} />
                        </div>
                        <p className="text-label font-normal text-muted-foreground">
                          Site haritasındaki {data.coverage.sitePagesTotal.toLocaleString('tr-TR')} sayfanın{' '}
                          {/* Eski API (gecis aninda) sitemapPagesVisited dondurmez */}
                          <strong>{Number(data.coverage.sitemapPagesVisited ?? data.coverage.uniquePathsVisited ?? 0).toLocaleString('tr-TR')}</strong> tanesini en az bir bot ziyaret etti.
                        </p>
                        {data.coverage.partial && (
                          <p className="text-label font-normal text-muted-foreground mt-1">
                            Ziyaret edilen adreslerin yalnızca bir kısmı kayıtlı (yüklenen loglardan her bot için günde en çok ziyaret edilen 10 adres saklanır); gerçek oran daha yüksek olabilir.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-sm"><strong>{data.coverage.uniquePathsVisited}</strong> tekil adres ziyaret edildi</p>
                        <p className="text-label font-normal text-muted-foreground mt-1">
                          {data.coverage.unavailableText
                            ?? (data.coverage.sitePagesTotal === 0
                              ? 'Site haritasında sayfa bulunamadı, oran hesaplanamıyor.'
                              : 'Site haritası okunamadı, oran hesaplanamıyor.')}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Bot bazinda dagilim */}
            <div className="rounded-lg border">
              <div className="px-4 py-2.5 border-b">
                <p className="v-rail">Bot Dağılımı (son 30 gün)</p>
              </div>
              <div className="divide-y text-sm max-h-[400px] overflow-y-auto">
                {botRows.map((row) => {
                  // Cubuk dogrulanmis ziyaretin paydasi; taklit hacmi buyuk bot ustte cikmaz
                  const pct = verification.verified > 0 ? (row.verified / verification.verified) * 100 : 0;
                  const recent = isNew(row.bot);
                  return (
                    <div
                      key={row.bot}
                      className={cn(
                        'px-4 py-2.5 transition-colors',
                        recent && 'bg-success/5',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: (row.category && CATEGORY_COLOR[row.category]) || CATEGORY_FALLBACK }} />
                          <span className="font-medium truncate">{row.label}</span>
                          {recent && (
                            <span className="inline-flex items-center gap-1 text-label px-1.5 py-0.5 rounded bg-success/10 text-success shrink-0">
                              <Sparkle className="h-2.5 w-2.5" /> Yeni
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-vitrin-rail text-muted-foreground shrink-0" title="Doğrulanmış ziyaret">
                          {row.verified.toLocaleString('tr-TR')} doğrulanmış
                        </span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: (row.category && CATEGORY_COLOR[row.category]) || CATEGORY_FALLBACK }} />
                      </div>
                      {row.unverified > 0 && (
                        <p className="text-label font-normal text-warning mt-1.5">{unverifiedText(row.bot, row.unverified)}</p>
                      )}
                      {row.unknown > 0 && (
                        <p className="text-label font-normal text-muted-foreground mt-0.5">
                          {unknownText(row.unknown, { hasMethod: row.hasMethod, needsCodeUpdate: !!data.ingestHealth?.needsCodeUpdate })}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
