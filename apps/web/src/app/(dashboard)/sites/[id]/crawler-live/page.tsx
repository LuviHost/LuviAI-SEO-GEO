'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
import { PlanLockedCard } from '@/components/plan-locked-card';
import { cn } from '@/lib/utils';
import {
  Activity, Flame, Copy, Wifi, WifiOff, Pause, Play, Cloud, Server,
  RefreshCw, KeyRound, AlertTriangle,
} from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';
import { MetricCard } from '@/components/ui/metric';
import { ingestNotices, normalizeCounts, sourceLabel, unverifiedText, verdictBadge } from '@/lib/crawler-verification';

const BADGE_TONE: Record<'ok' | 'warn' | 'muted', string> = {
  ok: 'text-success',
  warn: 'text-warning',
  muted: 'text-muted-foreground',
};

/**
 * Live Crawler — AI botlarının siteye CANLI ziyaret akışı.
 * Kaynak: Cloudflare Worker / WP eklentisi / nginx ajanı → 5 sn polling.
 * Cite fetch (ChatGPT-User vb.) = "şu anda bir cevapta kullanıldın" 🔥
 */

// Bot adlari notr (eskiden bot basina ayri sus rengi vardi); yalniz AI disi SEO
// tarayicilari soluk. Renk bu ekranda durum (dogrulama, HTTP kodu) icin kalir.
const BOT_COLOR: Record<string, string> = {
  'AhrefsBot': 'text-muted-foreground', 'SemrushBot': 'text-muted-foreground',
};

function timeAgo(ts: string | Date): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}sn önce`;
  if (s < 3600) return `${Math.floor(s / 60)}dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)}sa önce`;
  return `${Math.floor(s / 86400)}g önce`;
}

export default function CrawlerLivePage() {
  const { site } = useSiteContext();
  const { can, requirementFor } = useEntitlements();
  // Canli Tarayici kapisi api'de 'agency' (liveCrawler). 11.11.2026: Ajans satistan kalkti;
  // o plandaki mevcut hesap hakkini korur, yeni musteride ozellik Kurumsal'dadir ve kilit
  // kartindaki plan adi sunucudan gelir (requirementFor → featureOfferPlan). Alt planda uclar
  // 403 doner; sayfa hata/bos akis yerine kilit kartini gosterir.
  const allowed = can('liveCrawler');
  const [data, setData] = useState<any>(null);
  const [snippets, setSnippets] = useState<any>(null);
  const [tab, setTab] = useState<'worker' | 'wordpress' | 'nginx'>('worker');
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  // Yenileme sonrasi uyari ekranda KALICI durur: kullanici snippet'i yeniden
  // kurana kadar veri akmaz, tek seferlik toast bunu kacirmaya cok musait.
  const [rotated, setRotated] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    try {
      const res = await api.getLiveCrawler(site.id);
      setData(res);
    } catch { /* polling — sessiz gec */ } finally {
      setLoading(false);
    }
  };

  // Haklar KESIN gelene kadar istek atilmaz: kapali planda 5 sn'lik yoklama
  // her turda 403 uretirdi (diger kilitli sayfalarla ayni kural).
  useEffect(() => {
    if (allowed !== true) return;
    load();
    api.getLiveCrawlerSnippets(site.id).then(setSnippets).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, allowed]);

  useEffect(() => {
    if (allowed !== true) return;
    if (paused) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = setInterval(load, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, site.id, allowed]);

  if (allowed === false) {
    return (
      <PlanLockedCard
        requirement={requirementFor('liveCrawler')}
        description="AI botlarının (GPTBot, ClaudeBot, ChatGPT-User…) sitene yaptığı ziyaretleri anlık izler; bir cevapta canlı okunduğunda haber verir."
      />
    );
  }

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success('Kopyalandı'),
      () => toast.error('Kopyalanamadı'),
    );
  };

  const rotateSecret = async () => {
    if (!confirm(
      'Anahtarı yenilemek mevcut kurulumu bozar: eski anahtarla imzalanan istekler '
      + 'anında reddedilir ve snippet\'i yeniden kurana kadar bot ziyaretleri kaydedilmez.\n\n'
      + 'Devam edilsin mi?',
    )) return;

    setRotating(true);
    try {
      await api.rotateIngestSecret(site.id);
      // Yeni sir snippet metinlerinin ICINE gomulu; ekrandaki kodu tazelemezsek
      // kullanici eski (artik gecersiz) sirri kopyalamaya devam eder.
      const fresh = await api.getLiveCrawlerSnippets(site.id);
      setSnippets(fresh);
      setRotated(true);
      toast.success('Yeni anahtar üretildi');
    } catch (e: any) {
      toast.error(e?.message ?? 'Anahtar yenilenemedi');
    } finally {
      setRotating(false);
    }
  };

  const connected = data?.workerConnected;
  // Vitrin yalniz IP'si dogrulanmis cite'lari gosterir (api live-crawler recent)
  const cites: any[] = data?.citeFetches24h ?? [];
  const citeUnverified = data?.citeFetchCounts24h?.unverified ?? 0;
  const verification = normalizeCounts(data?.verification, data?.total ?? 0);
  const notices = ingestNotices(data?.ingestHealth);

  return (
    <div className="space-y-5">
      {/* Başlık */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <SectionHeader
          icon={Activity}
          title={
            <span className="inline-flex items-center gap-2">
              Canlı Tarayıcı
              <Badge variant={connected ? 'success' : 'secondary'} className="gap-1.5">
                {connected && <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden />}
                {connected ? 'Canlı' : 'Bekliyor'}
              </Badge>
            </span>
          }
          description={<>AI botlarının sitene son {data?.windowMinutes ?? 10} dakikadaki ziyaretleri. JavaScript gerekmez; GPTBot ve ClaudeBot dahil her bot görünür.</>}
        />
        <Button variant="outline" size="sm" onClick={() => setPaused((v) => !v)}>
          {paused ? <Play className="h-3.5 w-3.5 mr-1.5" /> : <Pause className="h-3.5 w-3.5 mr-1.5" />}
          {paused ? 'Devam' : 'Duraklat'}
        </Button>
      </div>

      {/* Bağlantı durumu */}
      <Card className={cn(connected ? 'border-success/25 bg-success/5' : 'border-warning/30 bg-warning/5')}>
        <CardContent className="p-4 flex items-center gap-3">
          {connected ? <Wifi className="h-5 w-5 text-success shrink-0" /> : <WifiOff className="h-5 w-5 text-warning shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">
              {connected
                ? `Kaynak bağlı (${sourceLabel(data?.lastEventSource)}) — gerçek zamanlı AI bot tespiti aktif`
                : 'Henüz canlı kaynak bağlı değil'}
            </div>
            <div className="text-xs text-muted-foreground">
              {data?.lastEventAt
                ? `Son kayıt: ${timeAgo(data.lastEventAt)} (${new Date(data.lastEventAt).toLocaleString('tr-TR')})`
                : 'Aşağıdaki kurulumlardan birini yap — Cloudflare Worker (önerilen), WordPress eklentisi veya nginx ajanı.'}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Kurulu kod eski (IP gondermiyor) / 429 ile dusen istekler */}
      {(notices.codeUpdate || notices.throttled) && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-4 space-y-1.5 text-xs">
            {notices.codeUpdate && (
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                <span><strong className="font-medium">{notices.codeUpdate}</strong></span>
              </div>
            )}
            {notices.throttled && (
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                <span>{notices.throttled}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Cite fetch — vitrin */}
      {cites.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="text-panel-3 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Flame className="h-4 w-4 text-brand" /> Canlı Cite Sinyalleri (24 saat)
              <span className="text-xs font-normal tracking-normal text-muted-foreground">— gerçek bir kullanıcının AI sohbetinde sayfan canlı çekildi (IP adresi doğrulandı)</span>
            </div>
            <div className="divide-y rounded-md border">
              {cites.map((c, i) => (
                <div key={i} className="flex items-center gap-2 px-2.5 py-2 text-xs">
                  <Flame className="h-3 w-3 text-brand shrink-0" />
                  <span className="font-medium">{c.bot}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{c.path}</span>
                  <span className="text-muted-foreground shrink-0">{timeAgo(c.ts)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {citeUnverified > 0 && (
        <p className="text-xs text-muted-foreground">
          Son 24 saatte {citeUnverified.toLocaleString('tr-TR')} istek kendini ChatGPT-User / Claude-User gibi canlı okuyucu olarak tanıttı
          ama IP adresi sağlayıcıya ait değil — taklit olabilir, cite sinyali sayılmadı.
        </p>
      )}

      {/* Sayaçlar — manset dogrulanmis ziyaret */}
      {data && data.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <MetricCard
            label="Doğrulanmış ziyaret"
            value={String(verification.verified)}
            hint={<>son {data.windowMinutes} dk · {data.total} isteğin {verification.unverified} tanesi taklit olabilir, {verification.unknown} tanesi doğrulanamadı</>}
          />
          {(data.byBot ?? []).slice(0, 5).map((b: any) => (
            <MetricCard
              key={b.bot}
              label={<span className="block truncate">{b.bot}</span>}
              value={String(b.verified ?? 0)}
              hint={
                <>
                  doğrulanmış
                  {(b.unverified ?? 0) > 0 && (
                    <span className="mt-1 block text-warning">{unverifiedText(b.bot, b.unverified)}</span>
                  )}
                </>
              }
            />
          ))}
        </div>
      )}

      {/* Canlı akış tablosu */}
      <Card>
        <CardContent className="p-4">
          <div className="text-panel-3 mb-3">Son ziyaretler <span className="font-normal text-muted-foreground">({data?.events?.length ?? 0})</span></div>
          {loading ? (
            <div className="text-sm text-muted-foreground p-4 text-center">Yükleniyor…</div>
          ) : !data || data.events.length === 0 ? (
            <div className="text-sm text-muted-foreground p-6 text-center">
              Son {data?.windowMinutes ?? 10} dakikada AI bot ziyareti yok
              {!connected && ' — önce aşağıdan bir kaynak bağla'}.
            </div>
          ) : (
            <div className="divide-y overflow-x-auto font-mono text-xs">
              {data.events.map((e: any) => {
                const badge = verdictBadge(e.verify);
                const liveCite = e.isCiteFetch && e.verify === 'verified';
                return (
                <div key={e.id} className={cn('flex min-w-[36rem] items-center gap-3 px-2 py-2', liveCite && 'bg-muted/60')}>
                  <span className="w-20 shrink-0 whitespace-nowrap text-muted-foreground">{timeAgo(e.ts)}</span>
                  <span className={cn('w-40 shrink-0 truncate', BOT_COLOR[e.bot] ?? '')}>
                    {liveCite && <Flame className="h-3 w-3 text-brand inline mr-1" />}{e.bot}
                  </span>
                  <span className={cn('w-28 shrink-0 truncate', BADGE_TONE[badge.tone])} title={badge.title}>{badge.label}</span>
                  <span className={cn('w-10 shrink-0', e.status < 300 ? 'text-success' : e.status < 500 ? 'text-warning' : 'text-danger')}>{e.status}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.path}</span>
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Kurulum */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-panel-3">Kaynak Bağla</div>
            <Button size="sm" variant="outline" onClick={rotateSecret} disabled={rotating || !snippets}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', rotating && 'animate-spin')} />
              {rotating ? 'Yenileniyor…' : 'Anahtarı Yenile'}
            </Button>
          </div>

          {rotated && (
            <div className="rounded-md border border-warning/30 bg-warning/5 p-3 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-medium text-foreground">
                  Yeni anahtar üretildi. Aşağıdaki snippet&apos;i yeniden kurmadan veri akmaz.
                </div>
                <div className="text-muted-foreground mt-0.5">
                  Eski anahtarla imzalanan istekler artık reddediliyor — kodu kopyalayıp Cloudflare Worker / WordPress / nginx tarafında değiştir.
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {([
              { key: 'worker', label: 'Cloudflare Worker', icon: Cloud, hint: 'önerilen' },
              { key: 'wordpress', label: 'WordPress', icon: Server, hint: 'eklenti' },
              { key: 'nginx', label: 'nginx', icon: Server, hint: 'log ajanı' },
            ] as const).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-chip border px-2.5 text-filter transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  tab === t.key
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                )}
              >
                <t.icon className="h-3 w-3" /> {t.label}
                <span className="text-label font-normal opacity-70">{t.hint}</span>
              </button>
            ))}
          </div>
          {snippets ? (
            <div className="space-y-1.5">
              <div className="flex items-start gap-1.5 text-label font-normal text-warning">
                <KeyRound className="h-3 w-3 shrink-0 mt-0.5" />
                <span>
                  Gizli ingest anahtarın bu kodun içine gömülü — <strong className="font-medium">bu kodu herkese açık bir yerde paylaşma</strong> (GitHub, forum, ekran görüntüsü).
                </span>
              </div>
              <div className="relative">
                <pre className="max-h-80 overflow-x-auto whitespace-pre rounded-md border bg-muted/40 p-3 font-mono text-xs">
                  {tab === 'worker' ? snippets.cloudflareWorker : tab === 'wordpress' ? snippets.wordpress : snippets.nginx}
                </pre>
                <Button
                  size="sm" variant="outline" className="absolute top-2 right-2 bg-card"
                  onClick={() => copy(tab === 'worker' ? snippets.cloudflareWorker : tab === 'wordpress' ? snippets.wordpress : snippets.nginx)}
                >
                  <Copy className="h-3.5 w-3.5 mr-1" /> Kopyala
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Kurulum kodları yükleniyor…</div>
          )}
          <p className="text-label font-normal text-muted-foreground">
            Worker/eklenti yalnızca kendini AI botu olarak tanıtan istekleri bildirir (ziyaretçi verisi gönderilmez), yanıtı geciktirmez (non-blocking).
            Gerçek bot olup olmadığını doğrulamak için isteğin IP adresi de gönderilir; RanksUp IP adresini saklamaz, yalnızca doğrulama sonucunu kaydeder.
            Kod sitene özel — site kimliği gömülü.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
