'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Activity, Bot, Calendar, FileText, Sparkles, Zap, Search, Send, ShieldCheck, TrendingUp, ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/info-tooltip';
import { CitationHistoryChart } from '@/components/citation-history-chart';
import { GeoLabPanel } from '@/components/geo-lab-panel';
import { GeoScoreCard } from '@/components/geo-score-card';
import { CrawlerHitsPanel } from '@/components/crawler-hits-panel';
import { AdsLabPanel } from '@/components/ads-lab-panel';

/**
 * Site detay sayfasinin VARSAYILAN gorunumu — kisanin tum panelin onunde
 * 4 kart + son aktivite ozeti gormesi icin. Detaylar 'Detayli Akis' sekmesinde.
 */
export function SiteOverviewDashboard({
  site, audit, articles, onRefresh,
}: {
  site: any;
  audit: any;
  articles: any[];
  onRefresh: () => void;
}) {
  const [autopilotBusy, setAutopilotBusy] = useState(false);
  const autopilot = site?.autopilot !== false;

  const toggleAutopilot = async () => {
    setAutopilotBusy(true);
    try {
      await api.setAutopilot(site.id, !autopilot);
      toast.success(`Otopilot ${!autopilot ? 'açıldı' : 'kapatıldı'}`);
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAutopilotBusy(false);
    }
  };

  const scheduled = articles.filter((a) => a.status === 'SCHEDULED');
  const published = articles.filter((a) => a.status === 'PUBLISHED');
  const generating = articles.filter((a) => a.status === 'GENERATING' || a.status === 'EDITING');
  const ready = articles.filter((a) => a.status === 'READY_TO_PUBLISH');

  const overallScore = audit?.overallScore ?? null;
  const geoScore = audit?.geoScore ?? null;
  const aiScore = audit?.checks?.aiCitations?.score ?? null;
  const issues = Array.isArray(audit?.issues) ? audit.issues : [];
  const criticalIssues = issues.filter((i: any) => i.severity === 'critical');

  const nextScheduled = scheduled
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, 3);

  return (
    <div className="space-y-5">
      {/* Sprint 6 — Saglik / hata banner */}
      <HealthBanner site={site} audit={audit} articles={articles} />

      {/* Otopilot bandi */}
      <div className={`rounded-xl border-2 p-4 transition-colors ${
        autopilot ? 'border-brand/40 bg-gradient-to-br from-brand/10 to-brand/5' : 'border-muted bg-muted/20'
      }`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className={`h-11 w-11 rounded-full grid place-items-center shrink-0 ${
              autopilot ? 'bg-brand text-white' : 'bg-muted-foreground/20 text-muted-foreground'
            }`}>
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <p className="font-bold text-base flex items-center gap-2">
                <InfoTooltip term="Otopilot">Otopilot</InfoTooltip> {autopilot ? 'AÇIK' : 'KAPALI'}
                {autopilot && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide bg-brand/20 text-brand rounded-full px-2 py-0.5 font-bold">
                    <Activity className="h-3 w-3 animate-pulse" /> Çalışıyor
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                {autopilot
                  ? 'LuviAI senin için audit, takvim, üretim, yayın ve sosyal post — hepsini otomatik yönetiyor. Detayları görmek için "Detaylı Akış" sekmesine geç.'
                  : 'Manuel modda. Her makale için kendin onay/üretim/yayın yapacaksın. Otomatik akışı açmak istersen sağdaki butona tıkla.'}
              </p>
            </div>
          </div>
          <Button onClick={toggleAutopilot} disabled={autopilotBusy} variant={autopilot ? 'outline' : 'default'}>
            {autopilotBusy ? '...' : autopilot ? 'Kapat' : '🤖 Otopilotu Aç'}
          </Button>
        </div>
      </div>

      {/* Sıradaki Aksiyon — kullanıcıyı yönlendiren widget */}
      <NextActionWidget site={site} audit={audit} articles={articles} onRefresh={onRefresh} />

      {/* 4 buyuk kart — Skor / Takvim / Yayinlar / AI Citation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <ScoreCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Site Skoru"
          value={overallScore !== null ? `${overallScore}` : '—'}
          subtext={
            criticalIssues.length > 0
              ? `${criticalIssues.length} kritik sorun`
              : issues.length > 0
                ? `${issues.length} bulgu`
                : 'sorun yok'
          }
          color={overallScore === null ? 'muted' : overallScore >= 80 ? 'green' : overallScore >= 60 ? 'yellow' : 'red'}
        />
        <ScoreCard
          icon={<Sparkles className="h-4 w-4" />}
          label={<InfoTooltip term="Citation">AI Görünürlük</InfoTooltip>}
          value={aiScore !== null ? `${aiScore}` : '—'}
          subtext="Claude · Gemini · ChatGPT"
          color={aiScore === null ? 'muted' : aiScore >= 60 ? 'green' : aiScore >= 30 ? 'yellow' : 'red'}
        />
        <ScoreCard
          icon={<Calendar className="h-4 w-4" />}
          label="Takvimde"
          value={`${scheduled.length}`}
          subtext={`${generating.length} üretiliyor · ${ready.length} hazır`}
          color="brand"
        />
        <ScoreCard
          icon={<Send className="h-4 w-4" />}
          label="Yayında"
          value={`${published.length}`}
          subtext="toplam yayınlanan"
          color="brand"
        />
      </div>

      {/* GEO Score Card — kapsamli saglik skoru */}
      <GeoScoreCard siteId={site.id} />

      {/* AI Görünürlük Trendi (otomatik gunluk takip) */}
      <CitationHistoryChart siteId={site.id} />

      {/* AI Crawler Trafigi (sunucu log analitigi) */}
      <CrawlerHitsPanel siteId={site.id} />

      {/* GEO Lab — Heatmap + Wikidata + Wikipedia + Reddit + Cross-Link + Training */}
      <GeoLabPanel siteId={site.id} />

      {/* Faz 11: Ads Lab — Google + Meta + GA4 */}
      <AdsLabPanel site={site} />

      {/* Sirada Yayinlanacaklar */}
      {nextScheduled.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold inline-flex items-center gap-2">
                <Zap className="h-4 w-4 text-brand" /> Sırada Yayınlanacaklar
              </p>
              <Link href={`/sites/${site.id}?tab=flow#articles`} className="text-xs text-brand hover:underline">
                Takvimi aç →
              </Link>
            </div>
            <div className="space-y-2">
              {nextScheduled.map((a) => {
                const d = new Date(a.scheduledAt);
                return (
                  <div key={a.id} className="flex items-center gap-3 p-2 rounded-md border hover:border-brand/40">
                    <div className="text-center min-w-[68px] bg-brand/10 text-brand rounded px-2 py-1">
                      <div className="text-[10px] font-bold tracking-wide">
                        {d.toLocaleDateString('tr-TR', { weekday: 'short' })}
                      </div>
                      <div className="text-sm font-bold leading-tight">
                        {d.getDate()}.{(d.getMonth() + 1).toString().padStart(2, '0')}
                      </div>
                      <div className="text-[10px] font-mono">
                        {d.getHours().toString().padStart(2, '0')}:{d.getMinutes().toString().padStart(2, '0')}
                      </div>
                    </div>
                    <p className="text-sm font-medium flex-1 min-w-0 truncate">{a.title || a.topic}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generating / Ready bandi */}
      {(generating.length > 0 || ready.length > 0) && (
        <Card>
          <CardContent className="p-4 space-y-2">
            {generating.length > 0 && (
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                  <strong>{generating.length}</strong> makale şu anda üretiliyor
                </p>
                <span className="text-xs text-muted-foreground">~3-4 dakika</span>
              </div>
            )}
            {ready.length > 0 && (
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  <strong>{ready.length}</strong> makale yayına hazır
                </p>
                <Link href={`/sites/${site.id}?tab=flow#articles`} className="text-xs text-brand hover:underline">
                  İncele →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Hizli linkler */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <QuickLink href={`/sites/${site.id}?tab=flow`} icon={<FileText className="h-4 w-4" />} label="Detaylı Akış" />
        <QuickLink href={`/sites/${site.id}?tab=report`} icon={<TrendingUp className="h-4 w-4" />} label="Rapor" />
        <QuickLink href={`/sites/${site.id}?tab=analytics`} icon={<Search className="h-4 w-4" />} label="Analytics" />
        <QuickLink href={`/sites/${site.id}?tab=settings`} icon={<ShieldCheck className="h-4 w-4" />} label="Ayarlar" />
      </div>
    </div>
  );
}

function ScoreCard({
  icon, label, value, subtext, color,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  value: string;
  subtext: string;
  color: 'green' | 'yellow' | 'red' | 'brand' | 'muted';
}) {
  const colorMap: Record<string, string> = {
    green: 'text-green-500',
    yellow: 'text-yellow-500',
    red: 'text-red-500',
    brand: 'text-brand',
    muted: 'text-muted-foreground',
  };
  return (
    <div className="rounded-lg border p-4 hover:border-brand/40 transition-colors">
      <div className={`flex items-center gap-2 text-xs font-medium ${colorMap[color]}`}>
        {icon}
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-3xl font-bold mt-2 ${colorMap[color]}`}>{value}</div>
      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{subtext}</p>
    </div>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href as any} className="rounded-lg border p-3 flex items-center justify-between gap-2 hover:border-brand/40 hover:bg-brand/5 transition-colors">
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon} {label}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}


// ──────────────────────────────────────────────────────────────────────
// SIRADAKI AKSIYON — Sprint 5 (kullanıcıya ne yapacağını söyleyen widget)
// ──────────────────────────────────────────────────────────────────────
function NextActionWidget({ site, audit, articles, onRefresh }: {
  site: any; audit: any; articles: any[]; onRefresh: () => void;
}) {
  const [autoFixing, setAutoFixing] = useState(false);

  const overallScore = audit?.overallScore ?? null;
  const issues: any[] = Array.isArray(audit?.issues) ? audit.issues : [];
  const autoFixable = issues.filter((i: any) => i.autoFixable);
  const scheduled = articles.filter((a) => a.status === 'SCHEDULED');
  const ready = articles.filter((a) => a.status === 'READY_TO_PUBLISH');

  const aiCitationProviders = audit?.checks?.aiCitations?.providers ?? [];
  const noAiSnapshot = aiCitationProviders.length === 0 || aiCitationProviders.every((p: any) => !p.available);

  // Aksiyonları öncelik sırasına göre sırala
  type Action = { id: string; icon: string; title: string; desc: string; cta: string; href?: string; onClick?: () => void; loading?: boolean };
  const actions: Action[] = [];

  // 1) Audit yoksa
  if (overallScore === null) {
    actions.push({
      id: 'audit',
      icon: '🔎',
      title: 'Site taraması yap',
      desc: 'Henüz audit çalışmamış. SEO + GEO sorunlarını tespit etmek için tarama başlat.',
      cta: 'Tarama Başlat',
      onClick: async () => {
        try {
          await api.runAuditNow(site.id);
          toast.success('Tarama başlatıldı, ~30 sn sonra sonuç gelir');
          setTimeout(onRefresh, 5000);
        } catch (err: any) { toast.error(err.message); }
      },
    });
  }

  // 2) Auto-fix
  if (autoFixable.length > 0) {
    actions.push({
      id: 'autofix',
      icon: '⚡',
      title: `${autoFixable.length} SEO sorununu otomatik düzelt`,
      desc: 'Sitemap, robots.txt, llms.txt gibi otomatik düzeltilebilen eksikleri tek tıkla halletsin.',
      cta: 'Şimdi düzelt',
      loading: autoFixing,
      onClick: async () => {
        setAutoFixing(true);
        try {
          await api.applyAutoFix(site.id, autoFixable.map((i: any) => i.id));
          toast.success('Düzeltme başlatıldı');
          setTimeout(onRefresh, 5000);
        } catch (err: any) { toast.error(err.message); }
        finally { setAutoFixing(false); }
      },
    });
  }

  // 3) AI snapshot yok
  if (noAiSnapshot && overallScore !== null) {
    actions.push({
      id: 'ai-citation',
      icon: '🧠',
      title: 'AI görünürlüğünü ölç',
      desc: 'ChatGPT, Claude, Gemini, Perplexity senin siteni biliyor mu? Test et.',
      cta: 'AI testini çalıştır',
      onClick: async () => {
        try {
          toast.info('AI testi başlatıldı (1-2 dk)…');
          await api.runCitationTest(site.id);
          toast.success('AI testi tamam');
          onRefresh();
        } catch (err: any) { toast.error(err.message); }
      },
    });
  }

  // 4) Takvim boş
  if (scheduled.length === 0 && ready.length === 0 && overallScore !== null) {
    actions.push({
      id: 'topics',
      icon: '🎯',
      title: 'İçerik takvimi oluştur',
      desc: 'AI başlık önerileri ile ilk yazıları takvime al — otomatik üretim ve yayın için.',
      cta: 'Başlık seç',
      href: `/sites/${site.id}?tab=flow`,
    });
  }

  // 5) Hazır yazı varsa onaya çağır
  if (ready.length > 0) {
    actions.push({
      id: 'review',
      icon: '👁️',
      title: `${ready.length} yazı onayını bekliyor`,
      desc: 'AI yazdı ama henüz yayınlanmadı — önizle ve onayla.',
      cta: 'Onaya git',
      href: `/sites/${site.id}?tab=flow`,
    });
  }

  // 6) Sıradaki yazı bilgisi
  const nextScheduled = scheduled
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
  if (nextScheduled && actions.length === 0) {
    const dt = new Date(nextScheduled.scheduledAt);
    actions.push({
      id: 'next',
      icon: '⏰',
      title: `Sıradaki yazı: "${nextScheduled.title?.slice(0, 50) ?? 'Başlıksız'}"`,
      desc: `${dt.toLocaleString('tr-TR', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} tarihinde otomatik üretilecek.`,
      cta: 'Takvimi gör',
      href: `/sites/${site.id}?tab=flow`,
    });
  }

  // Hiç aksiyon yoksa hiçbir şey gösterme
  if (actions.length === 0) return null;

  // Sadece ilk 3 aksiyonu göster
  const visible = actions.slice(0, 3);

  return (
    <div className="rounded-xl border-2 border-green-500/40 bg-gradient-to-br from-green-500/5 to-emerald-500/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">👋</span>
        <p className="font-semibold text-sm">Sıradaki Aksiyon{visible.length > 1 ? 'lar' : ''}</p>
        <span className="text-[10px] text-muted-foreground">— en yüksek etki için</span>
      </div>
      <div className="space-y-2">
        {visible.map((a, idx) => (
          <div key={a.id} className="rounded-lg bg-card border p-3 flex items-center gap-3 flex-wrap">
            <span className="text-xl shrink-0">{a.icon}</span>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-medium">
                {idx + 1}. {a.title}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{a.desc}</p>
            </div>
            {a.href ? (
              <Link href={a.href}>
                <Button size="sm" variant="outline">{a.cta}</Button>
              </Link>
            ) : (
              <Button size="sm" variant="outline" onClick={a.onClick} disabled={a.loading}>
                {a.loading ? '…' : a.cta}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────
// HEALTH BANNER — Sprint 6 (kritik hatalari gosterir)
// ──────────────────────────────────────────────────────────────────────
function HealthBanner({ site, audit, articles }: { site: any; audit: any; articles: any[] }) {
  const issues: { kind: 'error' | 'warning'; title: string; desc: string; cta?: { label: string; href: string } }[] = [];

  // 1) Yayin hedefi yok mu?
  const hasPublishTarget = audit?.publishTargetCount > 0 || (site as any)?.publishTargets?.length > 0;
  if (!hasPublishTarget && site?.onboardingCompletedAt) {
    issues.push({
      kind: 'error',
      title: 'Yayın hedefi yok',
      desc: 'Üretilen yazılar nereye gidecek belirlenmemiş. Hemen bir hedef ekle.',
      cta: { label: 'Hedef ekle', href: `/sites/${site.id}?tab=settings` },
    });
  }

  // 2) Audit yok mu?
  if (!audit && site?.onboardingCompletedAt) {
    issues.push({
      kind: 'warning',
      title: 'Site taraması yapılmadı',
      desc: 'SEO + GEO sorunları henüz tespit edilmedi. Tarama başlatmak için Skoru Yenile butonuna bas.',
    });
  }

  // 3) Failed article var mi?
  const failedArticles = articles.filter((a) => a.status === 'FAILED');
  if (failedArticles.length > 0) {
    issues.push({
      kind: 'error',
      title: `${failedArticles.length} yazı üretiminde hata`,
      desc: 'Yazı üretimi başarısız oldu — AI key bakiyesi bitmiş veya yayın hedefi düşmüş olabilir.',
      cta: { label: 'Detayları gör', href: `/sites/${site.id}?tab=flow` },
    });
  }

  // 4) Onaya bekleyen ama eski yazi var mi (3 gunden uzun)?
  const oldReady = articles.filter((a) => {
    if (a.status !== 'READY_TO_PUBLISH') return false;
    const created = new Date(a.updatedAt ?? a.createdAt);
    return Date.now() - created.getTime() > 3 * 86400000;
  });
  if (oldReady.length > 0) {
    issues.push({
      kind: 'warning',
      title: `${oldReady.length} yazı 3 günden uzun süredir onay bekliyor`,
      desc: 'AI yazdı ama yayınlanmadı. Onaya gitmek istersen Detaylı Akış sekmesine geç.',
      cta: { label: 'Onaya git', href: `/sites/${site.id}?tab=flow` },
    });
  }

  if (issues.length === 0) return null;

  return (
    <div className="space-y-2">
      {issues.map((iss, idx) => {
        const isError = iss.kind === 'error';
        return (
          <div
            key={idx}
            className={cn(
              'rounded-lg border-l-4 p-3 flex items-center gap-3 flex-wrap',
              isError
                ? 'border-l-red-500 bg-red-500/5 border border-red-500/30'
                : 'border-l-yellow-500 bg-yellow-500/5 border border-yellow-500/30',
            )}
          >
            <span className="text-xl shrink-0">{isError ? '🔴' : '⚠️'}</span>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-semibold">{iss.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{iss.desc}</p>
            </div>
            {iss.cta && (
              <Link href={iss.cta.href}>
                <Button size="sm" variant="outline">{iss.cta.label}</Button>
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
