'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Activity, Bot, Calendar, FileText, Sparkles, Zap, Search, Send, ShieldCheck, TrendingUp, ChevronRight,
  AlertTriangle, AlertCircle, CheckCircle2, Power,
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
  site, audit, articles, publishTargets, onRefresh,
}: {
  site: any;
  audit: any;
  articles: any[];
  publishTargets?: any[];
  onRefresh: () => void;
}) {

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
      <HealthBanner site={site} audit={audit} articles={articles} publishTargets={publishTargets ?? []} />

      {/* Sıradaki Aksiyon — kullanıcı sayfaya inince ilk gördüğü öğe (KPI'lerin üstünde) */}
      <NextActionWidget site={site} audit={audit} articles={articles} publishTargets={publishTargets ?? []} onRefresh={onRefresh} />

      {/* Site Skoru özeti — onboarding sonrası kullanıcı detayı doğrudan görsün */}
      <AuditSummaryInline site={site} audit={audit} />

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

      {/* Otomatik akış banner — İçerik tab'ına taşındı (yayın akışı = içerik kontrolü) */}

      {/* Sirada Yayinlanacaklar */}
      {nextScheduled.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold inline-flex items-center gap-2">
                <Zap className="h-4 w-4 text-brand" /> Sırada Yayınlanacaklar
              </p>
              <Link href={`/sites/${site.id}?tab=content`} className="text-xs text-brand hover:underline">
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
                <Link href={`/sites/${site.id}?tab=content`} className="text-xs text-brand hover:underline">
                  İncele →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Hizli linkler */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <QuickLink href={`/sites/${site.id}?tab=content`} icon={<FileText className="h-4 w-4" />} label="Içerik" />
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
function NextActionWidget({ site, audit, articles, publishTargets, onRefresh }: {
  site: any; audit: any; articles: any[]; publishTargets: any[]; onRefresh: () => void;
}) {
  // Aktif default publish target var mı? Auto-fix bunu gerektirir (FTP/SFTP/WordPress).
  const activeTarget = (publishTargets ?? []).find((t: any) => t?.isDefault && t?.isActive);
  const hasPublishTarget = !!activeTarget;
  const [autoFixing, setAutoFixing] = useState(false);

  const overallScore = audit?.overallScore ?? null;
  const issues: any[] = Array.isArray(audit?.issues) ? audit.issues : [];
  // Server schema: AuditIssue.fixable (autoFixable DEĞİL)
  const autoFixable = issues.filter((i: any) => i.fixable);
  const scheduled = articles.filter((a) => a.status === 'SCHEDULED');
  const ready = articles.filter((a) => a.status === 'READY_TO_PUBLISH');

  const aiCitationProviders = audit?.checks?.aiCitations?.providers ?? [];
  const noAiSnapshot = aiCitationProviders.length === 0 || aiCitationProviders.every((p: any) => !p.available);

  // Aksiyonları öncelik sırasına göre sırala
  type Action = { id: string; icon: string; title: string; desc: string; cta: string; href?: string; onClick?: () => void; loading?: boolean };
  const actions: Action[] = [];

  // 1) Audit henüz yoksa — onboarding tamamlandıysa bile bu state'e düşebilir (timing).
  //    Yine de "yeniden tara" değil, "tara" olarak göster.
  if (overallScore === null) {
    actions.push({
      id: 'audit',
      icon: '🔎',
      title: 'Site taramasını tamamla',
      desc: 'Onboarding sonucunda audit henüz hazır değil. Tarama 30sn sürer — şu an başlat.',
      cta: 'Taramayı çalıştır',
      onClick: async () => {
        try {
          await api.runAuditNow(site.id);
          toast.success('Tarama başlatıldı, ~30 sn sonra sonuç gelir');
          setTimeout(onRefresh, 5000);
        } catch (err: any) { toast.error(err.message); }
      },
    });
  }

  // 1.5) Auto-fix mümkün ama PUBLISH TARGET yok → öncelikle bunu çöz
  //      Bu olmadan auto-fix dosyaları yükleyemez, kullanıcı tıklar boşa gider.
  if (autoFixable.length > 0 && !hasPublishTarget) {
    actions.push({
      id: 'add-publish-target',
      icon: '🔌',
      title: 'Yayın hedefi ekle (auto-fix bunu gerektirir)',
      desc: `${autoFixable.length} otomatik düzeltme uygulanabilir ama bağlı bir yayın hedefi yok. FTP/SFTP/WordPress ekle ki sitemap.xml, robots.txt gibi dosyalar yüklensin.`,
      cta: 'Yayın hedefi ekle',
      href: `/sites/${site.id}?tab=content#publish-targets`,
    });
  }

  // 2) Auto-fix — neyin düzelteceğini description'da açık yaz (publish target VARSA)
  if (autoFixable.length > 0 && hasPublishTarget) {
    const FIX_LABEL: Record<string, string> = {
      sitemap_xml: 'Sitemap.xml',
      robots_txt: 'Robots.txt',
      llms_txt: 'llms.txt (AI crawler izni)',
      faq_schema: 'FAQ Schema',
      article_schema: 'Article Schema',
      organization_schema: 'Organization Schema',
      breadcrumb_schema: 'Breadcrumb Schema',
      open_graph: 'Open Graph meta',
      twitter_card: 'Twitter Card meta',
      hreflang: 'Hreflang',
      canonical: 'Canonical tag',
    };
    const labels = autoFixable.map((i: any) => FIX_LABEL[i.checkId] ?? i.checkId).filter(Boolean);
    const labelList = labels.length <= 3 ? labels.join(', ') : `${labels.slice(0, 3).join(', ')} +${labels.length - 3} daha`;

    actions.push({
      id: 'autofix',
      icon: '⚡',
      title: `${autoFixable.length} SEO sorununu otomatik düzelt`,
      desc: `Şunlar oluşturulup ${activeTarget?.type ? activeTarget.type.toUpperCase() : 'yayın hedefi'}'ne yüklenecek: ${labelList}.`,
      cta: 'Şimdi düzelt',
      loading: autoFixing,
      onClick: async () => {
        setAutoFixing(true);
        try {
          const fixIds = autoFixable.map((i: any) => i.checkId).filter(Boolean);
          toast.message(`Uygulanıyor: ${labels.join(', ')}`, {
            description: 'Backend dosyaları üretip yayın hedefine yüklüyor (~10-20sn).',
          });

          const result: any = await api.applyAutoFix(site.id, fixIds);

          // Yayın hedefi yoksa açık uyarı
          if (result?.reason === 'no-publish-target') {
            toast.error('Yayın hedefi yok — önce Ayarlar > Yayın Hedefleri sekmesinden FTP/SFTP/WordPress ekle.', {
              duration: 9000,
            });
            return;
          }

          const applied: string[] = Array.isArray(result?.applied) ? result.applied : [];
          const errors: Array<{ fix: string; error: string }> = Array.isArray(result?.errors) ? result.errors : [];

          if (applied.length > 0) {
            const appliedLabels = applied.map((f) => FIX_LABEL[f] ?? f).join(', ');
            toast.success(`${applied.length} düzeltme uygulandı: ${appliedLabels}`, { duration: 7000 });
          }
          if (errors.length > 0) {
            const errLine = errors.map((e) => `${FIX_LABEL[e.fix] ?? e.fix}: ${e.error}`).join(' · ');
            toast.error(`${errors.length} düzeltme başarısız — ${errLine}`, { duration: 9000 });
          }
          if (applied.length === 0 && errors.length === 0) {
            toast.warning('Hiçbir değişiklik yapılmadı (boş response).');
          }

          setTimeout(onRefresh, 3000);
        } catch (err: any) { toast.error(err.message); }
        finally { setAutoFixing(false); }
      },
    });
  }

  // 2.5) GEO Score düşük — manuel sayfa iyileştirmesi gerek
  const geoScore = audit?.geoScore ?? null;
  if (geoScore !== null && geoScore < 50 && autoFixable.length === 0) {
    actions.push({
      id: 'geo-improve',
      icon: '🔍',
      title: `GEO görünürlüğü zayıf (${geoScore}/100)`,
      desc: 'Schema markup, FAQ, llms.txt, speakable content eksik. Sayfa bazlı snippet üreticisi ile iyileştir.',
      cta: 'Snippet Üretici',
      href: `/sites/${site.id}?tab=data#snippet`,
    });
  }

  // 2.7) Site skoru düşük + autofix yok = manuel issue listesi göster
  if (overallScore !== null && overallScore < 60 && autoFixable.length === 0 && issues.length > 0) {
    actions.push({
      id: 'manual-issues',
      icon: '⚠️',
      title: `${issues.length} sorun manuel düzeltme bekliyor`,
      desc: 'Otomatik düzeltilmeyen sorunları Site Skoru kartında satır satır gör — her birinin ne demek + nasıl düzelteceği yazılı.',
      cta: 'Detayları gör',
      href: `/sites/${site.id}?tab=data#audit`,
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
      href: `/sites/${site.id}?tab=data#citation`,
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
      href: `/sites/${site.id}?tab=content`,
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
      href: `/sites/${site.id}?tab=content`,
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
      href: `/sites/${site.id}?tab=content`,
    });
  }

  // Hiç aksiyon yoksa hiçbir şey gösterme
  if (actions.length === 0) return null;

  /* ↑ actions listesi yukarıda doluyor; aşağı görsel render. */

  // Sadece ilk 3 aksiyonu göster
  const visible = actions.slice(0, 3);
  const primary = visible[0];
  const rest = visible.slice(1);

  return (
    <div className="rounded-2xl border-2 border-brand/50 bg-gradient-to-br from-brand/[0.06] via-violet-500/[0.04] to-fuchsia-500/[0.04] p-5 shadow-[0_8px_30px_-12px_rgba(124,58,237,0.25)]">
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-brand/15 text-brand">
          <Sparkles className="h-4 w-4" />
        </span>
        <p className="font-bold text-base">Sıradaki Aksiyon{visible.length > 1 ? 'lar' : ''}</p>
        <span className="text-[10px] uppercase tracking-widest text-brand/70 font-mono ml-auto">en yüksek etki için</span>
      </div>

      {/* Birincil aksiyon — büyük ve baskın */}
      <div className="rounded-xl bg-card border-2 border-brand/30 p-4 flex items-center gap-4 flex-wrap mb-2">
        <span className="text-3xl shrink-0">{primary.icon}</span>
        <div className="flex-1 min-w-[220px]">
          <p className="text-base font-semibold leading-snug">{primary.title}</p>
          <p className="text-xs text-muted-foreground mt-1">{primary.desc}</p>
        </div>
        {primary.href ? (
          <Link href={primary.href}>
            <Button size="lg" className="font-semibold">{primary.cta} →</Button>
          </Link>
        ) : (
          <Button size="lg" onClick={primary.onClick} disabled={primary.loading} className="font-semibold">
            {primary.loading ? '…' : `${primary.cta} →`}
          </Button>
        )}
      </div>

      {/* İkincil aksiyonlar — daha kompakt */}
      {rest.length > 0 && (
        <div className="space-y-2 mt-3">
          {rest.map((a, idx) => (
            <div key={a.id} className="rounded-lg bg-card/60 border p-3 flex items-center gap-3 flex-wrap">
              <span className="text-lg shrink-0">{a.icon}</span>
              <div className="flex-1 min-w-[180px]">
                <p className="text-sm font-medium">
                  {idx + 2}. {a.title}
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
      )}
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────
// HEALTH BANNER — Sprint 6 (kritik hatalari gosterir)
// ──────────────────────────────────────────────────────────────────────
function HealthBanner({ site, audit, articles, publishTargets }: { site: any; audit: any; articles: any[]; publishTargets: any[] }) {
  const issues: { kind: 'error' | 'warning'; title: string; desc: string; cta?: { label: string; href: string } }[] = [];

  // 1) Yayin hedefi yok mu?
  const hasPublishTarget = (publishTargets?.length ?? 0) > 0;
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
      cta: { label: 'Detayları gör', href: `/sites/${site.id}?tab=data` },
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
      cta: { label: 'Onaya git', href: `/sites/${site.id}?tab=content` },
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

// ──────────────────────────────────────────────────────────────────────
// AUDIT SUMMARY INLINE — Sağlık tab'ı: Site Skoru özet + ilk 3 sorun + detay linki
// ──────────────────────────────────────────────────────────────────────
function AuditSummaryInline({ site, audit }: { site: any; audit: any }) {
  if (!audit) return null;
  const overallScore = audit?.overallScore ?? null;
  const issues: any[] = Array.isArray(audit?.issues) ? audit.issues : [];

  const critical = issues.filter((i) => i.severity === 'critical');
  const warning = issues.filter((i) => i.severity === 'warning' || i.severity === 'major');
  const info = issues.filter((i) => i.severity === 'info' || i.severity === 'minor');
  const passing = Math.max(0, (audit?.totalChecks ?? 14) - issues.length);

  const topIssues = [...critical, ...warning, ...info].slice(0, 3);

  if (topIssues.length === 0 && overallScore !== null && overallScore >= 90) {
    return (
      <Card className="border-emerald-500/40 bg-emerald-500/5">
        <CardContent className="p-4 flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Site skoru: {overallScore}/100 — Mükemmel</p>
            <p className="text-xs text-muted-foreground">Tüm 14 SEO + GEO kontrolü temiz. İçerik üretimine odaklan.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (topIssues.length === 0) return null;

  const scoreColor =
    overallScore === null ? 'text-muted-foreground'
      : overallScore >= 80 ? 'text-emerald-500'
        : overallScore >= 60 ? 'text-amber-500'
          : 'text-red-500';

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-brand" />
            <div>
              <p className="text-sm font-semibold">Site Skoru Özeti</p>
              <p className="text-[11px] text-muted-foreground">14 SEO + GEO kontrolü</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <span className={cn('text-2xl font-bold', scoreColor)}>{overallScore ?? '—'}</span>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> {passing}
              </span>
              {critical.length > 0 && (
                <span className="inline-flex items-center gap-1 text-red-500">
                  <AlertCircle className="h-3.5 w-3.5" /> {critical.length}
                </span>
              )}
              {warning.length > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-500">
                  <AlertTriangle className="h-3.5 w-3.5" /> {warning.length}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          {topIssues.map((iss, i) => {
            const isCritical = iss.severity === 'critical';
            const isWarning = iss.severity === 'warning' || iss.severity === 'major';
            const Icon = isCritical ? AlertCircle : isWarning ? AlertTriangle : CheckCircle2;
            const colorClass = isCritical ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-muted-foreground';
            return (
              <div key={`${iss.checkId ?? iss.type}-${i}`} className="flex items-start gap-2.5 py-1.5 border-b last:border-0">
                <Icon className={cn('h-4 w-4 shrink-0 mt-0.5', colorClass)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug">{iss.description || iss.type}</p>
                </div>
                {iss.fixable && (
                  <Badge variant="outline" className="text-[10px] border-brand/40 text-brand shrink-0">
                    auto-fix
                  </Badge>
                )}
              </div>
            );
          })}
        </div>

        {issues.length > topIssues.length && (
          <Link
            href={`/sites/${site.id}?tab=data#audit`}
            className="text-xs text-brand hover:underline mt-3 inline-flex items-center gap-1"
          >
            {issues.length} sorunun tamamını gör <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// AUTOPILOT CONTROL — Yayın akış kontrolü + onay modu toggle'ı
// (Eski Ayarlar > ApprovalModeCard ile birleştirildi)
// ──────────────────────────────────────────────────────────────────────
export function AutopilotControl({
  site, onRefresh,
}: {
  site: any;
  onRefresh: () => void;
}) {
  const [autopilotBusy, setAutopilotBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const autopilot = site?.autopilot !== false;
  const approvalMode = site?.publishApprovalMode ?? 'manual_approve';
  const isAuto = approvalMode === 'auto_publish';

  const toggleAutopilot = async () => {
    setAutopilotBusy(true);
    try {
      await api.setAutopilot(site.id, !autopilot);
      toast.success(`Otomatik akış ${!autopilot ? 'açıldı' : 'durduruldu'}`);
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAutopilotBusy(false);
    }
  };

  const setMode = async (newMode: 'manual_approve' | 'auto_publish') => {
    if (newMode === approvalMode) return;
    setModeBusy(true);
    try {
      await api.updateSite(site.id, { publishApprovalMode: newMode });
      toast.success(newMode === 'auto_publish' ? 'Tam otomatik moda geçildi' : 'Yarı otomatik moda geçildi');
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setModeBusy(false);
    }
  };

  // 3 görsel state: paused (kapalı) | manual (yarı) | auto (tam)
  const stateKey = !autopilot ? 'paused' : isAuto ? 'auto' : 'manual';
  const config = {
    paused: {
      label: 'DURDURULDU',
      icon: '⏸️',
      ringClass: 'border-muted bg-muted/20',
      badgeBg: 'bg-muted-foreground/20 text-muted-foreground',
      badgeText: 'text-muted-foreground',
      desc: 'Otomatik akış kapalı. Yeni yazı üretilmiyor — açmak için sağdaki butona tıkla.',
    },
    manual: {
      label: 'YARI OTOMATİK',
      icon: '👁️',
      ringClass: 'border-blue-500/40 bg-gradient-to-br from-blue-500/10 to-blue-500/5',
      badgeBg: 'bg-blue-500 text-white',
      badgeText: 'text-blue-600 dark:text-blue-400',
      desc: 'AI yazıları üretip takvime alır. Her yazı YAYINLANMADAN önce onayını bekler — email/dashboard\'dan haber alırsın.',
    },
    auto: {
      label: 'TAM OTOMATİK',
      icon: '🚀',
      ringClass: 'border-brand/40 bg-gradient-to-br from-brand/10 to-brand/5',
      badgeBg: 'bg-brand text-white',
      badgeText: 'text-brand',
      desc: 'AI tüm akışı yönetiyor: üretim, görsel, schema, yayın ve sosyal post. Sen sadece haftalık raporu okursun.',
    },
  }[stateKey];

  return (
    <div className={`rounded-xl border-2 p-4 transition-colors ${config.ringClass}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Sol: icon + label + desc + mod toggle */}
        <div className="flex items-start gap-3 flex-1 min-w-[260px]">
          <div className={`h-11 w-11 rounded-full grid place-items-center shrink-0 text-xl ${config.badgeBg}`}>
            {config.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base flex items-center gap-2 flex-wrap">
              <span className={config.badgeText}>{config.label}</span>
              {autopilot && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide bg-foreground/10 rounded-full px-2 py-0.5 font-bold">
                  <Activity className="h-3 w-3 animate-pulse" /> Çalışıyor
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">{config.desc}</p>

            {/* Mod toggle — text bloğunun altında */}
            <div className="flex items-center gap-1.5 p-1 rounded-full border bg-card/60 max-w-fit mt-3">
              <button
                type="button"
                onClick={() => setMode('manual_approve')}
                disabled={!autopilot || modeBusy}
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all',
                  !autopilot && 'opacity-40 cursor-not-allowed',
                  autopilot && !isAuto && 'bg-blue-500 text-white shadow-sm',
                  autopilot && isAuto && 'text-muted-foreground hover:text-foreground',
                )}
              >
                👁️ Yarı Otomatik
              </button>
              <button
                type="button"
                onClick={() => setMode('auto_publish')}
                disabled={!autopilot || modeBusy}
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all',
                  !autopilot && 'opacity-40 cursor-not-allowed',
                  autopilot && isAuto && 'bg-brand text-white shadow-sm',
                  autopilot && !isAuto && 'text-muted-foreground hover:text-foreground',
                )}
              >
                🚀 Tam Otomatik
              </button>
            </div>
          </div>
        </div>

        {/* Sağ: Power toggle — outer items-center sayesinde tüm sol sütunun ortasına hizalanır */}
        <button
          type="button"
          onClick={toggleAutopilot}
          disabled={autopilotBusy}
          aria-label={autopilot ? 'Akışı durdur' : 'Akışı aç'}
          title={autopilot ? 'Akışı durdur' : 'Akışı aç'}
          className={cn(
            'relative grid place-items-center h-11 w-11 rounded-full border-2 shrink-0 transition-all duration-300',
            autopilotBusy && 'opacity-60 cursor-wait',
            autopilot
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/70'
              : 'border-brand/40 bg-brand/10 text-brand hover:bg-brand/20 hover:border-brand/60',
          )}
        >
          {autopilot && (
            <span className="absolute inset-0 rounded-full border-2 border-emerald-500/40 animate-ping" />
          )}
          <Power className="h-5 w-5 relative z-10" />
        </button>
      </div>
    </div>
  );
}
