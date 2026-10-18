'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bot, Upload, RefreshCw, Sparkle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
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

const CATEGORY_COLOR: Record<string, string> = {
  'ai-search': 'bg-purple-500',
  'training': 'bg-pink-500',
  'classic-search': 'bg-blue-500',
  'social': 'bg-green-500',
};

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

  const totalHits = data.totalHits ?? 0;
  const byCategory = data.byCategory ?? {};
  const byBot = data.byBot ?? {};
  const firstSeen: Record<string, string> = data.firstSeen ?? {};
  const sortedBots = Object.entries(byBot).sort((a, b) => (b[1] as number) - (a[1] as number));

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
            <p className="text-sm font-semibold inline-flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" /> AI Crawler Trafiği
            </p>
            {/* Google-Extended yazilmaz: ayri bir HTTP kullanici ajani yok, yalniz robots.txt
                belirteci — sunucu logunda hic gorunmez
                (https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers) */}
            <p className="text-xs text-muted-foreground mt-0.5">
              GPTBot · OAI-SearchBot · ClaudeBot · PerplexityBot sitenizi taradı mı?
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border rounded-md cursor-pointer hover:bg-muted">
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
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/[0.06] p-3 flex items-start gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0">
                  <Sparkle className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    {newBotIds.length === 1 ? 'Yeni AI bot ziyareti!' : `${newBotIds.length} yeni AI bot ziyareti!`}
                  </p>
                  <p className="text-xs text-foreground/80 mt-0.5">
                    Son {NEW_THRESHOLD_DAYS} gün içinde sitenizi <strong>ilk kez</strong> taramaya başladılar:{' '}
                    <span className="font-semibold">{newBotLabels.join(', ')}</span>
                    {newBotIds.length > newBotLabels.length && ` ve ${newBotIds.length - newBotLabels.length} bot daha`}.
                  </p>
                </div>
              </div>
            )}

            {/* Toplam ozet */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="rounded-md border p-3 text-center">
                <p className="text-2xl font-bold">{totalHits.toLocaleString('tr-TR')}</p>
                <p className="text-[11px] text-muted-foreground">Toplam İstek</p>
              </div>
              {Object.entries(byCategory).map(([cat, count]) => (
                <div key={cat} className="rounded-md border p-3 text-center">
                  <div className={`h-1.5 w-full rounded-full ${CATEGORY_COLOR[cat] ?? 'bg-muted'} mb-2`} />
                  <p className="text-2xl font-bold">{(count as number).toLocaleString('tr-TR')}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">{cat.replace('-', ' ')}</p>
                </div>
              ))}
            </div>

            {/* Clarity-style: Bot purpose split + Pages crawled coverage */}
            {(data.purposeSplit || data.coverage) && (
              <div className="grid md:grid-cols-2 gap-2">
                {/* Purpose split bar */}
                {data.purposeSplit && (
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-semibold mb-2">Bot Amaç Dağılımı</p>
                    <div className="flex h-2 rounded-full overflow-hidden bg-muted mb-2">
                      <div className="bg-blue-500" style={{ width: `${data.purposeSplit.aiSearchPct}%` }} title={`AI Search %${data.purposeSplit.aiSearchPct}`} />
                      <div className="bg-purple-500" style={{ width: `${data.purposeSplit.trainingPct}%` }} title={`Training %${data.purposeSplit.trainingPct}`} />
                      <div className="bg-emerald-500" style={{ width: `${data.purposeSplit.classicSearchPct}%` }} title={`Classic %${data.purposeSplit.classicSearchPct}`} />
                      <div className="bg-slate-500" style={{ width: `${data.purposeSplit.otherPct}%` }} />
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                      <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-blue-500" />AI Search %{data.purposeSplit.aiSearchPct}</span>
                      <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-purple-500" />Training %{data.purposeSplit.trainingPct}</span>
                      <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Classic %{data.purposeSplit.classicSearchPct}</span>
                    </div>
                  </div>
                )}
                {/* Page coverage */}
                {data.coverage && (
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-semibold mb-2">Sayfa Tarama Kapsamı</p>
                    {/* Oran = site haritasindaki sayfalardan EN AZ BIR bot ziyareti gorenler /
                        site haritasindaki sayfalar (crawler-analytics.service.ts computeCoverage).
                        Eskiden pay botlarin istedigi tum tekil yollardi (robots.txt, feed,
                        wp-json dahil) ve %100'de kirpiliyordu. Liste okunamazsa oran yok; nedeni
                        API'den gelir. partial: ziyaret listesi eksik, oran alt sinir. */}
                    {typeof data.coverage.pagesCrawledPct === 'number' && typeof data.coverage.sitePagesTotal === 'number' && data.coverage.sitePagesTotal > 0 ? (
                      <>
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-2xl font-bold">
                            {data.coverage.partial ? 'en az ' : ''}%{data.coverage.pagesCrawledPct}
                          </span>
                          <span className="text-label text-muted-foreground">ziyaret edildi</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-1.5">
                          <div className="h-full bg-gradient-to-r from-brand-500 to-brand-600" style={{ width: `${data.coverage.pagesCrawledPct}%` }} />
                        </div>
                        <p className="text-label text-muted-foreground">
                          Site haritasındaki {data.coverage.sitePagesTotal.toLocaleString('tr-TR')} sayfanın{' '}
                          {/* Eski API (gecis aninda) sitemapPagesVisited dondurmez */}
                          <strong>{Number(data.coverage.sitemapPagesVisited ?? data.coverage.uniquePathsVisited ?? 0).toLocaleString('tr-TR')}</strong> tanesini en az bir bot ziyaret etti.
                        </p>
                        {data.coverage.partial && (
                          <p className="text-label text-muted-foreground mt-1">
                            Ziyaret edilen adreslerin yalnızca bir kısmı kayıtlı (yüklenen loglardan her bot için günde en çok ziyaret edilen 10 adres saklanır); gerçek oran daha yüksek olabilir.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-xs"><strong>{data.coverage.uniquePathsVisited}</strong> tekil adres ziyaret edildi</p>
                        <p className="text-label text-muted-foreground mt-1">
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
            <div className="rounded-md border">
              <div className="px-3 py-2 border-b bg-muted/30">
                <p className="text-xs font-semibold">Bot Dağılımı (son 30 gün)</p>
              </div>
              <div className="divide-y text-xs max-h-[400px] overflow-y-auto">
                {sortedBots.map(([bot, hits]) => {
                  const info = data.registry?.[bot];
                  const pct = totalHits > 0 ? ((hits as number) / totalHits) * 100 : 0;
                  const recent = isNew(bot);
                  return (
                    <div
                      key={bot}
                      className={cn(
                        'px-3 py-2 transition-colors',
                        recent && 'bg-emerald-500/[0.05]',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${CATEGORY_COLOR[info?.category] ?? 'bg-muted'}`} />
                          <span className="font-medium truncate">{info?.label ?? bot}</span>
                          {recent && (
                            <span className="inline-flex items-center gap-0.5 text-label font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 shrink-0">
                              <Sparkle className="h-2.5 w-2.5" /> Yeni
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[11px] shrink-0">{(hits as number).toLocaleString('tr-TR')} ({pct.toFixed(1)}%)</span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${CATEGORY_COLOR[info?.category] ?? 'bg-muted-foreground'}`} style={{ width: `${pct}%` }} />
                      </div>
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
