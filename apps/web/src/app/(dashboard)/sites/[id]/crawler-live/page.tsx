'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Activity, Flame, Copy, Wifi, WifiOff, Pause, Play, Cloud, Server,
  RefreshCw, KeyRound, AlertTriangle,
} from 'lucide-react';

/**
 * Live Crawler — AI botlarının siteye CANLI ziyaret akışı.
 * Kaynak: Cloudflare Worker / WP eklentisi / nginx ajanı → 5 sn polling.
 * Cite fetch (ChatGPT-User vb.) = "şu anda bir cevapta kullanıldın" 🔥
 */

const BOT_COLOR: Record<string, string> = {
  'GPTBot': 'text-emerald-500', 'ChatGPT-User': 'text-emerald-400', 'OAI-SearchBot': 'text-emerald-300',
  'ClaudeBot': 'text-brand-500', 'Claude-User': 'text-brand-400', 'Claude-Web': 'text-brand-400', 'Claude-SearchBot': 'text-brand-300',
  'PerplexityBot': 'text-cyan-500', 'Perplexity-User': 'text-cyan-400',
  'Googlebot': 'text-blue-500', 'Google-Extended': 'text-blue-400', 'GoogleOther': 'text-blue-300',
  'Bingbot': 'text-sky-500', 'Amazonbot': 'text-yellow-600', 'Bytespider': 'text-purple-500',
  'Meta-ExternalAgent': 'text-indigo-500', 'Meta-ExternalFetcher': 'text-indigo-400',
  'AhrefsBot': 'text-zinc-500', 'SemrushBot': 'text-zinc-500',
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

  useEffect(() => {
    load();
    api.getLiveCrawlerSnippets(site.id).then(setSnippets).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  useEffect(() => {
    if (paused) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = setInterval(load, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, site.id]);

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
  const cites: any[] = data?.citeFetches24h ?? [];

  return (
    <div className="space-y-5">
      {/* Başlık */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 grid place-items-center">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              Live Crawler
              <Badge variant="outline" className={cn('text-[10px]', connected ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : 'bg-zinc-500/10 text-zinc-500')}>
                {connected ? <><span className="relative flex h-1.5 w-1.5 mr-1"><span className="animate-ping absolute h-full w-full rounded-full bg-emerald-500 opacity-75" /><span className="relative rounded-full h-1.5 w-1.5 bg-emerald-500" /></span> LIVE</> : 'BEKLEMEDE'}
              </Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              AI botlarının siteye <strong>anlık</strong> ziyaretleri (son {data?.windowMinutes ?? 10} dk). JS gerekmez — edge'den beslenir, GPTBot/ClaudeBot dahil her bot görünür.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setPaused((v) => !v)}>
          {paused ? <Play className="h-3.5 w-3.5 mr-1.5" /> : <Pause className="h-3.5 w-3.5 mr-1.5" />}
          {paused ? 'Devam' : 'Duraklat'}
        </Button>
      </div>

      {/* Bağlantı durumu */}
      <Card className={cn(connected ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5')}>
        <CardContent className="p-4 flex items-center gap-3">
          {connected ? <Wifi className="h-5 w-5 text-emerald-500 shrink-0" /> : <WifiOff className="h-5 w-5 text-amber-500 shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">
              {connected
                ? `Kaynak bağlı (${data?.lastEventSource === 'wp' ? 'WordPress eklentisi' : data?.lastEventSource === 'log' ? 'nginx ajanı' : 'Cloudflare Worker'}) — gerçek zamanlı AI bot tespiti aktif`
                : 'Henüz canlı kaynak bağlı değil'}
            </div>
            <div className="text-xs text-muted-foreground">
              {data?.lastEventAt
                ? `Son event: ${timeAgo(data.lastEventAt)}`
                : 'Aşağıdaki kurulumlardan birini yap — Cloudflare Worker (önerilen), WordPress eklentisi veya nginx ajanı.'}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cite fetch — vitrin */}
      {cites.length > 0 && (
        <Card className="border-red-500/30">
          <CardContent className="p-4 space-y-2">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Flame className="h-4 w-4 text-red-500" /> Canlı Cite Sinyalleri (24 saat)
              <span className="text-xs text-muted-foreground font-normal">— gerçek bir kullanıcının AI sohbetinde sayfan canlı çekildi</span>
            </div>
            <div className="space-y-1">
              {cites.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs rounded-md bg-red-500/5 px-2.5 py-1.5">
                  <Flame className="h-3 w-3 text-red-500 shrink-0" />
                  <span className="font-semibold">{c.bot}</span>
                  <span className="font-mono text-muted-foreground flex-1 truncate">{c.path}</span>
                  <span className="text-muted-foreground shrink-0">{timeAgo(c.ts)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sayaçlar */}
      {data && data.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card>
            <CardContent className="p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Toplam İstek</div>
              <div className="text-2xl font-bold">{data.total}</div>
              <div className="text-[10px] text-muted-foreground">son {data.windowMinutes} dk</div>
            </CardContent>
          </Card>
          {(data.byBot ?? []).slice(0, 5).map((b: any) => (
            <Card key={b.bot}>
              <CardContent className="p-3.5">
                <div className={cn('text-[10px] font-semibold uppercase tracking-wide mb-1 truncate', BOT_COLOR[b.bot] ?? 'text-muted-foreground')}>{b.bot}</div>
                <div className="text-2xl font-bold">{b.hits}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Canlı akış tablosu */}
      <Card>
        <CardContent className="p-4">
          <div className="text-sm font-semibold mb-3">Son {data?.events?.length ?? 0} Ziyaret</div>
          {loading ? (
            <div className="text-sm text-muted-foreground p-4 text-center">Yükleniyor…</div>
          ) : !data || data.events.length === 0 ? (
            <div className="text-sm text-muted-foreground p-6 text-center">
              Son {data?.windowMinutes ?? 10} dakikada AI bot ziyareti yok
              {!connected && ' — önce aşağıdan bir kaynak bağla'}.
            </div>
          ) : (
            <div className="space-y-0.5 font-mono text-xs">
              {data.events.map((e: any) => (
                <div key={e.id} className={cn('flex items-center gap-3 rounded px-2 py-1.5', e.isCiteFetch ? 'bg-red-500/5' : 'odd:bg-muted/30')}>
                  <span className="text-muted-foreground w-16 shrink-0">{timeAgo(e.ts)}</span>
                  <span className={cn('w-40 shrink-0 truncate font-semibold', BOT_COLOR[e.bot] ?? '')}>
                    {e.isCiteFetch && <Flame className="h-3 w-3 text-red-500 inline mr-1" />}{e.bot}
                  </span>
                  <span className={cn('w-10 shrink-0', e.status < 300 ? 'text-emerald-500' : e.status < 500 ? 'text-amber-500' : 'text-red-500')}>{e.status}</span>
                  <span className="flex-1 truncate text-muted-foreground">{e.path}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Kurulum */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm font-semibold">Kaynak Bağla</div>
            <Button
              size="sm" variant="outline" onClick={rotateSecret} disabled={rotating || !snippets}
              className="text-amber-600 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/10"
            >
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', rotating && 'animate-spin')} />
              {rotating ? 'Yenileniyor…' : 'Anahtarı Yenile'}
            </Button>
          </div>

          {rotated && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-semibold text-amber-700 dark:text-amber-300">
                  Yeni anahtar üretildi. Aşağıdaki snippet&apos;i yeniden kurmadan veri akmaz.
                </div>
                <div className="text-muted-foreground mt-0.5">
                  Eski anahtarla imzalanan istekler artık reddediliyor — kodu kopyalayıp Cloudflare Worker / WordPress / nginx tarafında değiştir.
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-1.5">
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
                  'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors inline-flex items-center gap-1.5',
                  tab === t.key ? 'bg-brand text-white border-brand' : 'bg-card hover:border-brand/50',
                )}
              >
                <t.icon className="h-3 w-3" /> {t.label}
                <span className={cn('text-[9px]', tab === t.key ? 'text-white/70' : 'text-muted-foreground')}>{t.hint}</span>
              </button>
            ))}
          </div>
          {snippets ? (
            <div className="space-y-1.5">
              <div className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                <KeyRound className="h-3 w-3 shrink-0 mt-0.5" />
                <span>
                  Gizli ingest anahtarın bu kodun içine gömülü — <strong>bu kodu herkese açık bir yerde paylaşma</strong> (GitHub, forum, ekran görüntüsü).
                </span>
              </div>
              <div className="relative">
                <pre className="rounded-lg bg-muted/50 border p-3 text-[11px] overflow-x-auto max-h-80 whitespace-pre">
                  {tab === 'worker' ? snippets.cloudflareWorker : tab === 'wordpress' ? snippets.wordpress : snippets.nginx}
                </pre>
                <Button
                  size="sm" variant="outline" className="absolute top-2 right-2"
                  onClick={() => copy(tab === 'worker' ? snippets.cloudflareWorker : tab === 'wordpress' ? snippets.wordpress : snippets.nginx)}
                >
                  <Copy className="h-3.5 w-3.5 mr-1" /> Kopyala
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Kurulum kodları yükleniyor…</div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Worker/eklenti yalnızca AI bot isteklerini bildirir (ziyaretçi verisi gönderilmez), yanıtı geciktirmez (non-blocking).
            Kod sitene özel — site kimliği gömülü.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
