'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { LucideIcon } from 'lucide-react';
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight, Bot, CalendarClock, CheckCircle2, ClipboardList,
  Eye, FileText, Image as ImageIcon, Loader2, Pause, PenLine, Plug, PieChart, Power, Rocket,
  ScanSearch, Send, ShieldAlert, ShieldCheck, Sparkles, Wand2, Wrench, XCircle,
} from 'lucide-react';
import {
  aiCitationOf, aiCitationSkipLabel, api, autoFixIssues, autoFixMessages, geoAccessOf, geoSampleNote, isRobotsFixKey,
  isUnverifiedCheck, rootFileTarget,
} from '@/lib/api';
import { crawlAccessTitle, currentCrawlAccess, type CrawlAccess } from '@/lib/crawl-access';
// robots.txt yalniz onizleme + acik onayla yazilir (API 'preview_required') — Ajan Hazirligi ile ayni diyalog
import { AutoFixPreviewDialog } from '@/app/(dashboard)/sites/[id]/agent-readiness/auto-fix-preview-dialog';
import { CrawlAccessNotice } from '@/components/crawl-access-notice';
import { cn } from '@/lib/utils';
import { siteHref, type SiteRoute } from '@/lib/site-routes';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MetricCard } from '@/components/ui/metric';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CitationHistoryChart } from '@/components/citation-history-chart';
import { RanksUpImpactCard } from '@/components/ranksup-impact-card';
import { TestimonialWidget } from '@/components/testimonial-widget';
import { QuotaMonitor } from '@/components/quota-monitor';
import { CrawlerHitsPanel } from '@/components/crawler-hits-panel';
import { AiCostStrip } from '@/components/ai-cost-strip';
import { RecentActivity } from '@/components/recent-activity';

/**
 * Site Genel Bakis — UC BOLGE:
 *   (a) Siradaki adim: TEK kart. Eskiden HealthBanner ve NextActionWidget ayni
 *       ilk-kurulum sinyalini FARKLI mantikla iki kez veriyordu ("Yayin hedefi
 *       yok" herhangi bir hedefe, "Yayin hedefi ekle" varsayilan+aktif hedefe
 *       bakiyordu). Artik tek liste, tek kural: AKTIF bir hedef var mi
 *       (sunucudaki auto-fix de herhangi bir aktif hedefi kullaniyor).
 *   (b) Tek KPI satiri (ui/metric) — her kutu kendi iskeletiyle.
 *   (c) Sekmeler: trendler / sorunlar / AI tarayicilar / maliyet / aktivite.
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
  const published = articles.filter((a) => a.status === 'PUBLISHED');
  const showTestimonial =
    published.length >= 1 ||
    (articles.length >= 3 && new Date(site.createdAt ?? 0).getTime() < Date.now() - 7 * 86400_000);
  // Son tarama anasayfayi okuyamadiysa eldeki skor guncel degil (API yeni skor uretmez)
  const access = currentCrawlAccess(site?.crawlAccess ?? audit?.accessBlocked, audit);

  return (
    <div className="space-y-6">
      <NextStepCard site={site} audit={audit} articles={articles} publishTargets={publishTargets ?? []} onRefresh={onRefresh} />
      <KpiRow siteId={site.id} audit={audit} articles={articles} access={access} />
      <OverviewTabs site={site} audit={audit} articles={articles} />
      {showTestimonial && <TestimonialWidget siteId={site.id} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// (a) SIRADAKI ADIM
// ──────────────────────────────────────────────────────────────────────

type Tone = 'danger' | 'warning' | 'brand' | 'info';

const TONE_CHIP: Record<Tone, string> = {
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  brand: 'bg-brand/10 text-brand',
  info: 'bg-info/10 text-info',
};

type Step = {
  id: string;
  tone: Tone;
  icon: LucideIcon;
  title: string;
  desc: string;
  cta: string;
  href?: string;
  run?: () => Promise<void>;
};

const FIX_LABEL: Record<string, string> = {
  sitemap_xml: 'Sitemap.xml',
  robots_txt: 'Robots.txt',
  // llms.txt bir izin dosyasi DEGIL (tarayici izni robots.txt'te); eski etiket yanlisti
  llms_txt: 'llms.txt',
  faq_schema: 'FAQ şeması',
  article_schema: 'Article şeması',
  organization_schema: 'Organization şeması',
  breadcrumb_schema: 'Breadcrumb şeması',
  open_graph: 'Open Graph meta',
  twitter_card: 'Twitter Card meta',
  hreflang: 'Hreflang',
  canonical: 'Canonical etiketi',
};

const fixLabel = (id: string) => FIX_LABEL[id] ?? id;

function NextStepCard({ site, audit, articles, publishTargets, onRefresh }: {
  site: any; audit: any; articles: any[]; publishTargets: any[]; onRefresh: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [stuckCount, setStuckCount] = useState(0);
  /** robots.txt onizleme diyalogu — acikken duzeltme anahtari ('robots_txt') */
  const [robotsPreviewKey, setRobotsPreviewKey] = useState<string | null>(null);

  // Takili sayfalar (DETECTED) — plan disindaysa API reddeder, sessizce 0
  useEffect(() => {
    let cancelled = false;
    api.listStuckPages(site.id, 'DETECTED')
      .then((rows) => { if (!cancelled) setStuckCount(Array.isArray(rows) ? rows.length : 0); })
      .catch(() => { if (!cancelled) setStuckCount(0); });
    return () => { cancelled = true; };
  }, [site.id]);

  const steps = useMemo(
    () => buildSteps({ site, audit, articles, publishTargets, stuckCount, onRefresh, onPreviewRobots: setRobotsPreviewKey }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [site, audit, articles, publishTargets, stuckCount],
  );

  const runStep = async (step: Step) => {
    if (!step.run) return;
    setBusy(step.id);
    try { await step.run(); } finally { setBusy(null); }
  };

  const href = (route: SiteRoute) => siteHref(site.id, route);

  const robotsDialog = (
    <AutoFixPreviewDialog
      siteId={site.id}
      fixKey={robotsPreviewKey}
      checkName="Robots.txt"
      open={robotsPreviewKey !== null}
      onOpenChange={(o) => { if (!o) setRobotsPreviewKey(null); }}
      onApplied={onRefresh}
    />
  );

  if (steps.length === 0) {
    return (
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-success/10 text-success">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Her şey yolunda</h2>
          <p className="text-sm text-muted-foreground">Şu an bekleyen bir adım yok. Otomatik akış çalışmaya devam ediyor.</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={href('actionPlan')}>Aksiyon planı <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
        </Button>
      </Card>
    );
  }

  const [primary, ...rest] = steps;
  const visibleRest = rest.slice(0, 3);
  const PrimaryIcon = primary.icon;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          Sıradaki adım
          {steps.length > 1 && <Badge variant="brand">{steps.length} iş</Badge>}
        </h2>
        <Link href={href('actionPlan')} className="inline-flex items-center gap-1 text-label text-muted-foreground hover:text-brand">
          <ClipboardList className="h-3.5 w-3.5" aria-hidden /> Tüm aksiyon planı
        </Link>
      </div>

      {/* Birincil adim */}
      <div className="flex flex-wrap items-center gap-4 p-5">
        <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-md', TONE_CHIP[primary.tone])}>
          <PrimaryIcon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-[14rem] flex-1">
          <p className="text-base font-semibold leading-snug">{primary.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{primary.desc}</p>
        </div>
        <StepAction step={primary} busy={busy === primary.id} onRun={runStep} primary />
      </div>

      {/* Diger adimlar */}
      {visibleRest.length > 0 && (
        <ul className="divide-y border-t">
          {visibleRest.map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md', TONE_CHIP[s.tone])}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-[12rem] flex-1">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-label text-muted-foreground">{s.desc}</p>
                </div>
                <StepAction step={s} busy={busy === s.id} onRun={runStep} />
              </li>
            );
          })}
        </ul>
      )}
      {robotsDialog}
    </Card>
  );
}

function StepAction({ step, busy, onRun, primary }: { step: Step; busy: boolean; onRun: (s: Step) => void; primary?: boolean }) {
  const variant = primary ? 'default' : 'outline';
  const size = primary ? 'default' : 'sm';
  if (step.href) {
    return (
      <Button asChild variant={variant} size={size} className="shrink-0">
        <Link href={step.href as any}>
          {step.cta} {primary && <ArrowRight className="h-4 w-4" aria-hidden />}
        </Link>
      </Button>
    );
  }
  return (
    <Button variant={variant} size={size} className="shrink-0" onClick={() => onRun(step)} disabled={busy} aria-busy={busy}>
      {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
      {step.cta}
    </Button>
  );
}

/**
 * Adim listesi — ONCELIK SIRASIYLA. Ilk oge birincil kart olur.
 * Saf fonksiyon: ayni girdi ayni listeyi verir (tek kural kaynagi).
 */
function buildSteps({ site, audit, articles, publishTargets, stuckCount, onRefresh, onPreviewRobots }: {
  site: any; audit: any; articles: any[]; publishTargets: any[]; stuckCount: number; onRefresh: () => void;
  /** robots.txt onizleme diyalogunu acar (toplu duzeltmeye girmez) */
  onPreviewRobots: (fixKey: string) => void;
}): Step[] {
  const href = (route: SiteRoute) => siteHref(site.id, route);
  const steps: Step[] = [];

  // TEK KURAL: aktif hedef (varsayilan once). Sunucu auto-fix'i herhangi bir aktif hedefle yapar.
  const activeTarget =
    publishTargets.find((t: any) => t?.isActive && t?.isDefault) ?? publishTargets.find((t: any) => t?.isActive);
  const hasPublishTarget = !!activeTarget;
  // Kok dosyalari (sitemap.xml / robots.txt / llms.txt) yalniz FTP / SFTP / cPanel yazar;
  // WordPress REST yazamaz — sunucudaki auto-fix ayni kurali uygular (lib/api.ts rootFileTarget)
  const fileTarget = rootFileTarget(publishTargets);

  // Son tarama anasayfayi okuyamadiysa eldeki tarama guncel degil (engel
  // sayfasindan uretilmis olabilir): ondan otomatik duzeltme / sorun adimi
  // turetilmez — once erisim duzelmeli.
  const access = currentCrawlAccess(site?.crawlAccess ?? audit?.accessBlocked, audit);
  const overallScore: number | null = access ? null : (audit?.overallScore ?? null);
  const geoScore: number | null = access ? null : (audit?.geoScore ?? null);
  const issues: any[] = !access && Array.isArray(audit?.issues) ? audit.issues : [];
  // fixRoute (API /audit/latest ekler): auto_fix = kok dosya uretilip yuklenir;
  // snippet = meta/sema sayfa sayfa; images = alt metni. Dogrulanamayan kontrolun
  // sorunu otomatik duzeltme almaz (lib/api.ts autoFixIssues).
  const autoFixable = !access ? autoFixIssues(audit) : [];
  // robots.txt toplu yazilmaz: mevcut dosyayla birlesir, onizleme + acik onay ister
  const robotsFixable = autoFixable.filter((i: any) => isRobotsFixKey(i.checkId));
  const bulkFixable = autoFixable.filter((i: any) => !isRobotsFixKey(i.checkId));
  const geo = geoAccessOf(audit);
  const snippetFixable = issues.filter((i: any) => i.fixRoute === 'snippet');
  const imageAltIssues = issues.filter((i: any) => i.fixRoute === 'images');
  const scheduled = articles.filter((a) => a.status === 'SCHEDULED');
  const ready = articles.filter((a) => a.status === 'READY_TO_PUBLISH');
  const failed = articles.filter((a) => a.status === 'FAILED');
  const oldReady = ready.filter((a) => Date.now() - new Date(a.updatedAt ?? a.createdAt).getTime() > 3 * 86400000);
  const onboarded = !!site?.onboardingCompletedAt;

  const aiProviders: any[] = audit?.checks?.aiCitations?.providers ?? [];
  const noAiSnapshot = aiProviders.length === 0 || aiProviders.every((p: any) => !p.available);
  // Denetimin AI adımı haftalık ölçüm hakkı dolu olduğu için atlandıysa son 7 günde bir ölçüm
  // yapılmış demektir ve yenisi şu an başlatılamaz — "AI görünürlüğünü ölç" çıkmaz yol olurdu.
  const aiWeeklyLimitSkip = aiCitationOf(audit)?.skipped?.code === 'WEEKLY_MEASUREMENT_LIMIT';

  // 0) Tarayicimiz siteyi okuyamiyor (WAF, robots.txt, DNS...) — skor uretilmedi.
  // "Taramayi baslat" demek yaniltici olur: once erisime izin verilmeli.
  if (access) {
    steps.push({
      id: 'crawl-access',
      tone: access.state === 'blocked' ? 'warning' : 'danger',
      icon: ShieldAlert,
      title: crawlAccessTitle(access),
      desc: `${access.reason} ${access.hint}`.trim(),
      cta: 'Tekrar dene',
      run: async () => {
        try {
          await api.runAuditNow(site.id);
          toast.success('Erişim sağlandı, site skoru hesaplandı');
        } catch (err: any) {
          toast.error(err.message);
        } finally {
          onRefresh();
        }
      },
    });
  }

  // 1) Tarama yok
  if (overallScore === null && !access) {
    steps.push({
      id: 'audit',
      tone: onboarded ? 'warning' : 'brand',
      icon: ScanSearch,
      title: 'Site taramasını başlat',
      desc: 'SEO ve GEO sorunları henüz tespit edilmedi. Tarama yaklaşık 30 saniye sürer.',
      cta: 'Taramayı başlat',
      run: async () => {
        try {
          await api.runAuditNow(site.id);
          toast.success('Tarama başladı, yaklaşık 30 saniye içinde sonuç gelir');
          setTimeout(onRefresh, 5000);
        } catch (err: any) { toast.error(err.message); }
      },
    });
  }

  // 2) Aktif yayin hedefi yok — kurulum bittiyse ya da otomatik duzeltme bunu bekliyorsa
  if (!hasPublishTarget && (onboarded || autoFixable.length > 0)) {
    steps.push({
      id: 'publish-target',
      tone: 'danger',
      icon: Plug,
      title: 'Yayın hedefi ekle',
      desc: autoFixable.length > 0
        ? `${autoFixable.length} sorun sitemap.xml, robots.txt ya da llms.txt yüklenerek düzeltilebilir ama bağlı bir yayın hedefi yok. Bu dosyalar için FTP, SFTP ya da cPanel ekle; yazılar için WordPress de olur.`
        : 'Üretilen yazıların nereye yayınlanacağı belli değil. WordPress, FTP ya da SFTP ekle.',
      cta: 'Yayın hedefi ekle',
      href: href('publishTargets'),
    });
  } else if (hasPublishTarget && !fileTarget && bulkFixable.length > 0) {
    // Hedef var ama kok dosya yazamiyor (or. yalniz WordPress): "Simdi duzelt" sessizce
    // 'no_file_target' hatasi alirdi — once dogru hedef
    steps.push({
      id: 'file-target',
      tone: 'warning',
      icon: Plug,
      title: 'Kök dosyalar için FTP / SFTP hedefi ekle',
      desc: `${bulkFixable.length} sorun sitemap.xml / llms.txt yüklenerek düzeltilebilir. Bunun için FTP, SFTP ya da cPanel bağlantısı gerekli; WordPress REST kök dosya yazamaz.`,
      cta: 'Yayın hedefi ekle',
      href: href('publishTargets'),
    });
  }

  // 3) Uretimi basarisiz yazilar
  if (failed.length > 0) {
    steps.push({
      id: 'failed',
      tone: 'danger',
      icon: XCircle,
      title: `${failed.length} yazı üretilemedi`,
      desc: 'AI anahtarının bakiyesi bitmiş ya da yayın hedefi erişilemez olabilir. Yazıyı açıp yeniden dene.',
      cta: 'Yazıları gör',
      href: href('articles'),
    });
  }

  // 4) Otomatik duzeltme — yalniz sitemap.xml / llms.txt ve kok dosya yazabilen hedef VARSA
  if (bulkFixable.length > 0 && fileTarget) {
    const fixIds: string[] = [...new Set<string>(bulkFixable.map((i: any) => i.checkId).filter(Boolean))];
    const labels = fixIds.map(fixLabel);
    const labelList = labels.length <= 3 ? labels.join(', ') : `${labels.slice(0, 3).join(', ')} ve ${labels.length - 3} tane daha`;
    steps.push({
      id: 'autofix',
      tone: 'brand',
      icon: Wand2,
      title: `${bulkFixable.length} SEO sorununu otomatik düzelt`,
      // Yazimdan once kok klasor kaniti icin ranksup-verify.txt yuklenir ve sitede kalir
      // (api audit/auto-fix.service.ts proveRootDir / ROOT_VERIFY_NOTE) — kullanici bilsin
      desc: `${fileTarget.name || String(fileTarget.type ?? '').toUpperCase() || 'Yayın hedefin'} üzerine yüklenecek: ${labelList}. Dosya yoksa oluşturulur; senin dosyanın üzerine yazılmaz. Yazmadan önce küçük bir doğrulama dosyası (ranksup-verify.txt) yüklenip yayın hedefinin bu siteyi sunduğu kontrol edilir; bu dosya sitende kalır.`,
      cta: 'Şimdi düzelt',
      run: async () => {
        try {
          toast.message(`Uygulanıyor: ${labels.join(', ')}`, {
            description: 'Dosyalar üretilip yayın hedefine yükleniyor (10-20 sn).',
          });
          const result = await api.applyAutoFix(site.id, fixIds);
          if (result?.reason === 'no-publish-target') {
            toast.error('Aktif yayın hedefi yok — önce Yayın Hedefleri sayfasından FTP, SFTP ya da cPanel ekle.', { duration: 9000 });
            return;
          }
          // Hata ve "degisiklik gerekmedi" metinleri API'den, oldugu gibi. "Uygulandi"
          // yalniz sitede dogrulanan dosya icin; yuklenip canli adreste gorunmeyen
          // dosya uyari olarak (lib/api.ts autoFixMessages, onizleme diyalogu ile ayni kural)
          const msg = autoFixMessages(result, fixLabel);
          if (msg.verified.length > 0) toast.success(`${msg.verified.length} düzeltme uygulandı ve sitede doğrulandı: ${msg.verified.map(fixLabel).join(', ')}`, { duration: 7000 });
          if (msg.unverifiedFixes.length > 0) toast.warning(`${msg.unverifiedFixes.map(fixLabel).join(', ')} yazıldı ama sitede doğrulanamadı`, { description: msg.unverified.join(' · '), duration: 10000 });
          if (msg.errors.length > 0) toast.error(msg.errors.length === 1 ? 'Düzeltme uygulanmadı' : `${msg.errors.length} düzeltme uygulanmadı`, { description: msg.errors.join(' · '), duration: 10000 });
          if (msg.unchanged.length > 0) toast.message('Değişiklik gerekmedi', { description: msg.unchanged.join(' · '), duration: 8000 });
          if (msg.unsupported.length > 0) toast.warning(`${msg.unsupported.length} madde otomatik düzeltilemez: ${msg.unsupported.map(fixLabel).join(', ')}`, { duration: 9000 });
          if (msg.applied.length === 0 && msg.errors.length === 0 && msg.unchanged.length === 0 && msg.unsupported.length === 0) toast.warning('Hiçbir değişiklik yapılmadı.');
          setTimeout(onRefresh, 3000);
        } catch (err: any) { toast.error(err.message); }
      },
    });
  }

  // 4b) robots.txt — toplu yazilmaz; onizleme diyalogu (yayin hedefi olmadan da elle kopyalama sunar)
  if (robotsFixable.length > 0) {
    const key: string = robotsFixable[0]?.checkId ?? 'robots_txt';
    steps.push({
      id: 'robots-preview',
      tone: 'brand',
      icon: Eye,
      title: 'robots.txt önerisini önizle',
      desc: 'Eksik AI bot grupları mevcut kurallarına dokunulmadan eklenir; yazmadan önce farkı görüp onaylarsın. Engelleri kaldırmak senin kararın.',
      cta: 'Önizle',
      run: async () => { onPreviewRobots(key); },
    });
  }

  // 5) Onay bekleyen yazilar (eski bekleyenler ayrica vurgulanir)
  if (ready.length > 0) {
    steps.push({
      id: 'review',
      tone: oldReady.length > 0 ? 'warning' : 'brand',
      icon: Eye,
      title: `${ready.length} yazı onayını bekliyor`,
      desc: oldReady.length > 0
        ? `${oldReady.length} tanesi 3 günden uzun süredir bekliyor. Önizle ve yayına al.`
        : 'AI yazdı ama henüz yayınlanmadı. Önizle ve onayla.',
      cta: 'Onaya git',
      href: href('articles'),
    });
  }

  // 6) Sayfa bazli (snippet) duzeltmeler
  if (snippetFixable.length > 0) {
    steps.push({
      id: 'snippet',
      tone: 'brand',
      icon: PenLine,
      title: `${snippetFixable.length} sorun sayfa bazında düzeltilebilir`,
      desc: 'Başlık, meta, şema ve GEO işaretlemesi sayfa sayfa üretilir; WordPress’e uygulanır ya da kopyalanır.',
      cta: 'Sayfa SEO’yu aç',
      href: href('snippet'),
    });
  }

  // 7) Gorsel alt metni
  if (imageAltIssues.length > 0) {
    steps.push({
      id: 'image-alt',
      tone: 'info',
      icon: ImageIcon,
      title: 'Görsellerde eksik alt metni',
      desc: imageAltIssues.map((i: any) => i.description).filter(Boolean)[0] ?? 'Alt metni olmayan görseller var.',
      cta: 'Görselleri düzelt',
      href: href('images'),
    });
  }

  // 8) Takili sayfalar
  if (stuckCount > 0) {
    steps.push({
      id: 'stuck',
      tone: 'warning',
      icon: Wrench,
      title: `${stuckCount} sayfa ilk sayfada takılı`,
      desc: 'Google’da ilk sayfadalar ama ilk 3’e giremiyorlar. Küçük iyileştirmelerle yukarı taşınabilirler.',
      cta: 'Sayfaları kurtar',
      href: href('stuckPages'),
    });
  }

  // 9) GEO skoru dusuk ve otomatik duzeltme yok
  if (geoScore !== null && geoScore < 50 && autoFixable.length === 0) {
    const note = geoSampleNote(geo.sample);
    steps.push({
      id: 'geo',
      tone: 'warning',
      icon: Sparkles,
      title: `AI görünürlük altyapısı zayıf (${geoScore}/100)`,
      desc: `Şema, SSS, llms.txt ve okunabilir içerik eksik. Sayfa SEO aracıyla sayfa sayfa iyileştir.${note ? ` ${note}` : ''}`,
      cta: 'İyileştir',
      href: href('snippet'),
    });
  }

  // 9b) GEO orneklemi erisim engeline takildi — skor yok; "zayif" demek yalan olurdu.
  // Anasayfa taramasi da engelliyse (access) 0. adim zaten nedeni soyluyor.
  if (!access && audit && audit.geoScore == null && geo.blocked) {
    steps.push({
      id: 'geo-blocked',
      tone: 'warning',
      icon: ShieldAlert,
      title: 'AI arama skoru ölçülemedi',
      desc: `${geo.blocked.reason} ${geo.blocked.hint}`.trim(),
      cta: 'Site skoruna git',
      href: href('audit'),
    });
  }

  // 10) Dusuk skor + elle duzeltilecek sorunlar
  if (overallScore !== null && overallScore < 60 && autoFixable.length === 0 && issues.length > 0) {
    steps.push({
      id: 'manual',
      tone: 'warning',
      icon: AlertTriangle,
      title: `${issues.length} sorun elle düzeltilmeyi bekliyor`,
      desc: 'Site Skoru sayfasında her sorunun ne anlama geldiğini ve nasıl düzelteceğini gör.',
      cta: 'Sorunları gör',
      href: href('audit'),
    });
  }

  // 11) AI olcumu yok
  if (noAiSnapshot && !aiWeeklyLimitSkip && overallScore !== null) {
    steps.push({
      id: 'ai-citation',
      tone: 'info',
      icon: Bot,
      title: 'AI görünürlüğünü ölç',
      // Ölçülen 6 asistan (ai-citation.service.ts runForSite)
      desc: 'ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek siteni biliyor mu? Ölç ve takibe al.',
      cta: 'Ölçümü başlat',
      href: href('visibility'),
    });
  }

  // 12) Takvim bos
  if (scheduled.length === 0 && ready.length === 0 && overallScore !== null) {
    steps.push({
      id: 'topics',
      tone: 'brand',
      icon: FileText,
      title: 'İçerik takvimini oluştur',
      desc: 'AI başlık önerilerinden ilk yazıları seç; üretim ve yayın otomatik ilerlesin.',
      cta: 'Başlık seç',
      href: href('articles'),
    });
  }

  // 13) Baska is yoksa siradaki yazi bilgisi
  const next = [...scheduled].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
  if (next && steps.length === 0) {
    const dt = new Date(next.scheduledAt);
    steps.push({
      id: 'next',
      tone: 'info',
      icon: CalendarClock,
      title: `Sıradaki yazı: “${next.title?.slice(0, 60) ?? 'Başlıksız'}”`,
      desc: `${dt.toLocaleString('tr-TR', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} tarihinde otomatik üretilecek.`,
      cta: 'Takvimi gör',
      href: href('articles'),
    });
  }

  return steps;
}

// ──────────────────────────────────────────────────────────────────────
// (b) KPI SATIRI
// ──────────────────────────────────────────────────────────────────────

function KpiTile({ href, loading, title, children }: { href: string; loading?: boolean; title?: string; children: React.ReactNode }) {
  if (loading) return <Skeleton className="h-full min-h-[150px] w-full" aria-label="Yükleniyor" />;
  return (
    <Link href={href as any} title={title} className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      {children}
    </Link>
  );
}

const pct = (v: number | null | undefined) => (typeof v === 'number' ? v : null);

function KpiRow({ siteId, audit, articles, access }: { siteId: string; audit: any; articles: any[]; access?: CrawlAccess | null }) {
  const [kpis, setKpis] = useState<any>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [headline, setHeadline] = useState<any>(null);
  const [headlineLoading, setHeadlineLoading] = useState(true);

  // Iki kaynak paralel; her kutu kendi kaynagi gelince acilir (veri hazir tablolardan, olcum KOSMAZ)
  useEffect(() => {
    let cancelled = false;
    setKpisLoading(true);
    setHeadlineLoading(true);
    api.getAiKpis(siteId)
      .then((d) => { if (!cancelled) setKpis(d); })
      .catch(() => { if (!cancelled) setKpis(null); })
      .finally(() => { if (!cancelled) setKpisLoading(false); });
    api.getCitationHeadline(siteId, 14)
      .then((r) => { if (!cancelled) setHeadline(r?.headline ?? null); })
      .catch(() => { if (!cancelled) setHeadline(null); })
      .finally(() => { if (!cancelled) setHeadlineLoading(false); });
    return () => { cancelled = true; };
  }, [siteId]);

  const href = (route: SiteRoute) => siteHref(siteId, route);

  // Site skoru — baglamdan. Son deneme engellendiyse eski skor gosterilmez (guncel degil).
  const overallScore: number | null = access ? null : (audit?.overallScore ?? null);
  const issues: any[] = Array.isArray(audit?.issues) ? audit.issues : [];
  const autoFixable = autoFixIssues(audit).length;

  // Icerik — baglamdan
  const published = articles.filter((a) => a.status === 'PUBLISHED').length;
  const scheduled = articles.filter((a) => a.status === 'SCHEDULED').length;
  const generating = articles.filter((a) => a.status === 'GENERATING' || a.status === 'EDITING').length;

  // AI gorunurluk manseti — grafikle AYNI kaynak (7g ortalama); yoksa tarama anindaki skor.
  // Taramanin AI adimi atlandiysa (haftalik hak, kota) o skor bir olcum DEGIL: eski kayitlar
  // bu durumda 0 yaziyordu, tile "0" gosteriyordu. Yalniz gercekten olculen skor yedek olur.
  const auditAi = aiCitationOf(audit);
  const aiScore: number | null = headline?.score ?? (auditAi?.measured ? auditAi.score : null);
  const aiHint = headline?.method === 'rolling' ? '7 günlük ortalama' : headline?.method === 'first-run' ? 'İlk ölçüm' : 'Atıf skoru';
  // F10: atif olcum yontemi (CITATION_MATCH_VERSION) iki pencere arasinda degistiyse fark siteden
  // degil olcuden — rozet gosterilmez, notr not yazilir. Alani tasimayan eski API'de false.
  const aiMethodChanged = headline?.methodChanged === true;
  const aiDelta = !aiMethodChanged && typeof headline?.deltaVsPrev === 'number' && headline.deltaVsPrev !== 0
    ? headline.deltaVsPrev
    : undefined;
  // Kutu dar: yalniz en sik neden (haftalik hak, sonraki tarihle) yazilir; digerleri Site Skoru kartinda
  const aiTileHint = aiScore === null
    ? (auditAi?.skipped?.code === 'WEEKLY_MEASUREMENT_LIMIT' ? aiCitationSkipLabel(auditAi) : 'Henüz ölçülmedi')
    : aiMethodChanged ? `${aiHint} · Kıyas yok: ölçüm yöntemi güncellendi` : aiHint;

  // Mansetteki anilma YALNIZ markasiz sorulardan: marka adi soruda gecince anilmasi totolojik
  const mention = pct(kpis?.mentionRate?.value);
  const branded = pct(kpis?.brandedMentionRate?.value);
  const citedNotMentioned = pct(kpis?.citedNotMentionedRate?.value);
  const mix = kpis?.queryMix as { branded: number; unbranded: number } | undefined;
  const cmp = kpis?.comparability as { mentions?: string } | undefined;
  const scopeNote =
    cmp?.mentions === 'scope_changed' ? 'Kıyas yok: ölçülen sorular değişti'
      : cmp?.mentions === 'method_changed' ? 'Kıyas yok: ölçüm yöntemi güncellendi'
        : null;
  const mentionHint = [
    scopeNote,
    branded !== null ? `Markalı sorularda %${branded}` : null,
    citedNotMentioned !== null && citedNotMentioned > 0 ? `Atıf var, ad anılmadı %${citedNotMentioned}` : null,
  ].filter(Boolean).join(' · ') || 'Son 7 gün';
  const mentionHelp =
    'Marka adı sorunun içinde geçmeyen sorulardaki anılma oranı — asıl görünürlük ölçüsü budur. ' +
    'Marka adı geçen sorularda anılmak beklenen bir sonuç olduğu için ayrı tutulur.' +
    (mix ? ` Son 7 gün: ${mix.unbranded} markasız, ${mix.branded} markalı ölçüm.` : '') +
    (citedNotMentioned !== null ? ' "Atıf var, ad anılmadı": siten kaynak gösterildi ama marka adın cevapta geçmedi.' : '');

  const sov = pct(kpis?.shareOfVoice?.value);
  const crawler = pct(kpis?.aiCrawlerHits?.value);
  const delta = (v: unknown) => (typeof v === 'number' && v !== 0 && !scopeNote ? v : undefined);

  return (
    <section aria-labelledby="kpi-heading">
      <h2 id="kpi-heading" className="sr-only">Temel göstergeler</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile href={href('audit')}>
          <MetricCard
            className="h-full"
            icon={ShieldCheck}
            label="Site skoru"
            value={overallScore ?? '—'}
            suffix={overallScore !== null ? '/100' : undefined}
            hint={access ? crawlAccessTitle(access) : overallScore === null ? 'Tarama bekleniyor' : autoFixable > 0 ? `${issues.length} sorun · ${autoFixable} otomatik` : `${issues.length} sorun`}
          />
        </KpiTile>
        <KpiTile href={href('visibility')} loading={headlineLoading}>
          <MetricCard
            className="h-full"
            icon={Sparkles}
            label="AI görünürlük"
            value={aiScore ?? '—'}
            delta={aiDelta}
            deltaSuffix=" puan"
            hint={aiTileHint}
          />
        </KpiTile>
        {/* Aciklama title'da: link icine tiklanabilir ipucu koymak gezinmeyi tetikler */}
        <KpiTile href={href('geoLab')} loading={kpisLoading} title={mentionHelp}>
          <MetricCard
            className="h-full"
            icon={Bot}
            label="Anılma oranı (markasız)"
            value={mention ?? '—'}
            suffix={mention !== null ? '%' : undefined}
            delta={delta(kpis?.mentionRate?.deltaPct)}
            deltaSuffix=" puan"
            hint={mention === null ? 'Henüz ölçülmedi' : mentionHint}
          />
        </KpiTile>
        <KpiTile href={href('competitors')} loading={kpisLoading}>
          <MetricCard
            className="h-full"
            icon={PieChart}
            label="Ses payı"
            value={sov ?? '—'}
            suffix={sov !== null ? '%' : undefined}
            delta={delta(kpis?.shareOfVoice?.deltaPct)}
            deltaSuffix=" puan"
            hint={sov === null ? 'Henüz ölçülmedi' : 'Rakiplere göre · 7 gün'}
          />
        </KpiTile>
        <KpiTile href={href('crawler')} loading={kpisLoading}>
          <MetricCard
            className="h-full"
            icon={Activity}
            label="AI bot ziyareti"
            value={crawler ?? '—'}
            delta={typeof kpis?.aiCrawlerHits?.deltaPct === 'number' && kpis.aiCrawlerHits.deltaPct !== 0 ? kpis.aiCrawlerHits.deltaPct : undefined}
            deltaSuffix="%"
            hint={crawler === null ? 'Veri yok' : 'Son 7 gün'}
          />
        </KpiTile>
        <KpiTile href={href('articles')}>
          <MetricCard
            className="h-full"
            icon={Send}
            label="Yayında"
            value={published}
            hint={generating > 0 ? `${scheduled} takvimde · ${generating} üretiliyor` : `${scheduled} takvimde`}
          />
        </KpiTile>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// (c) SEKMELER
// ──────────────────────────────────────────────────────────────────────

const TAB_KEY = 'ranksup_overview_tab';
const TABS = [
  { id: 'trends', label: 'Trendler' },
  { id: 'issues', label: 'Sorunlar' },
  { id: 'crawler', label: 'AI tarayıcılar' },
  { id: 'cost', label: 'Maliyet ve kota' },
  { id: 'activity', label: 'Aktivite' },
] as const;

function OverviewTabs({ site, audit, articles }: { site: any; audit: any; articles: any[] }) {
  const [tab, setTab] = useState<string>('trends');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TAB_KEY);
      if (saved && TABS.some((t) => t.id === saved)) setTab(saved);
    } catch { /* noop */ }
  }, []);
  const onChange = (v: string) => {
    setTab(v);
    try { window.localStorage.setItem(TAB_KEY, v); } catch { /* noop */ }
  };

  return (
    <Tabs value={tab} onValueChange={onChange}>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <TabsList aria-label="Genel bakış bölümleri" className="w-max">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="trends" className="mt-4 space-y-4">
        <RanksUpImpactCard siteId={site.id} days={90} />
        <CitationHistoryChart siteId={site.id} siteName={site.name} siteUrl={site.url} />
      </TabsContent>

      <TabsContent value="issues" className="mt-4">
        <AuditSummary site={site} audit={audit} />
      </TabsContent>

      <TabsContent value="crawler" className="mt-4">
        <CrawlerHitsPanel siteId={site.id} />
      </TabsContent>

      <TabsContent value="cost" className="mt-4 space-y-4">
        <AiCostStrip siteId={site.id} />
        <QuotaMonitor />
      </TabsContent>

      <TabsContent value="activity" className="mt-4 space-y-4">
        <PipelineStatus siteId={site.id} articles={articles} />
        <UpcomingArticles siteId={site.id} articles={articles} />
        <RecentActivity articles={articles} audit={audit} siteId={site.id} />
      </TabsContent>
    </Tabs>
  );
}

/** Uretimde / yayina hazir yazi sayilari */
function PipelineStatus({ siteId, articles }: { siteId: string; articles: any[] }) {
  const generating = articles.filter((a) => a.status === 'GENERATING' || a.status === 'EDITING').length;
  const ready = articles.filter((a) => a.status === 'READY_TO_PUBLISH').length;
  if (generating === 0 && ready === 0) return null;
  return (
    <Card className="divide-y">
      {generating > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-warning motion-reduce:animate-none" aria-hidden />
            <strong className="tabular-nums">{generating}</strong> yazı şu anda üretiliyor
          </span>
          <span className="text-label text-muted-foreground">yaklaşık 3-4 dakika</span>
        </div>
      )}
      {ready > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
            <strong className="tabular-nums">{ready}</strong> yazı yayına hazır
          </span>
          <Link href={siteHref(siteId, 'articles')} className="text-label font-medium text-brand hover:underline">
            İncele
          </Link>
        </div>
      )}
    </Card>
  );
}

/** Takvimdeki ilk 3 yazi */
function UpcomingArticles({ siteId, articles }: { siteId: string; articles: any[] }) {
  const next = articles
    .filter((a) => a.status === 'SCHEDULED')
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, 3);
  if (next.length === 0) return null;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4 text-brand" aria-hidden /> Sırada yayınlanacaklar
        </h3>
        <Link href={siteHref(siteId, 'articles')} className="text-label font-medium text-brand hover:underline">
          Takvimi aç
        </Link>
      </div>
      <ul className="space-y-2">
        {next.map((a) => {
          const d = new Date(a.scheduledAt);
          return (
            <li key={a.id} className="flex items-center gap-3 rounded-md border p-2.5">
              <span className="min-w-[68px] rounded-md bg-brand/10 px-2 py-1.5 text-center text-brand-700 dark:text-brand-300">
                <span className="block text-label">{d.toLocaleDateString('tr-TR', { weekday: 'short' })}</span>
                <span className="block text-sm font-semibold leading-tight tabular-nums">
                  {d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })}
                </span>
                <span className="block text-label tabular-nums">
                  {d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.title || a.topic}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Site skoru ozeti: ilk 3 sorun + tamamina baglanti */
function AuditSummary({ site, audit }: { site: any; audit: any }) {
  const access = currentCrawlAccess(site?.crawlAccess ?? audit?.accessBlocked, audit);
  if (access) {
    return <CrawlAccessNotice access={access} staleScoreAt={audit?.ranAt} compact />;
  }
  if (!audit) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        <ScanSearch className="h-4 w-4 shrink-0" aria-hidden />
        Henüz tarama yok. Sıradaki adım kartından taramayı başlatabilirsin.
      </div>
    );
  }
  const overallScore: number | null = audit?.overallScore ?? null;
  const issues: any[] = Array.isArray(audit?.issues) ? audit.issues : [];
  const critical = issues.filter((i) => i.severity === 'critical');
  const warning = issues.filter((i) => i.severity === 'warning' || i.severity === 'major');
  const info = issues.filter((i) => i.severity === 'info' || i.severity === 'minor');
  const totalChecks = audit?.totalChecks ?? 14;
  const passing = Math.max(0, totalChecks - issues.length);
  const topIssues = [...critical, ...warning, ...info].slice(0, 3);

  if (topIssues.length === 0) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-success" aria-hidden />
        <div>
          <p className="text-sm font-semibold">Site skoru {overallScore ?? '—'}/100 — sorun yok</p>
          <p className="text-label text-muted-foreground">{totalChecks} SEO + GEO kontrolünün tamamı temiz. İçerik üretimine odaklan.</p>
        </div>
      </Card>
    );
  }

  const scoreTone =
    overallScore === null ? 'text-muted-foreground'
      : overallScore >= 80 ? 'text-success'
        : overallScore >= 60 ? 'text-warning'
          : 'text-danger';

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn('text-metric-lg tabular-nums', scoreTone)}>{overallScore ?? '—'}</span>
          <div>
            <h3 className="text-sm font-semibold">Site skoru özeti</h3>
            <p className="text-label text-muted-foreground">{totalChecks} SEO + GEO kontrolü</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden /> {passing} geçti</Badge>
          {critical.length > 0 && <Badge variant="danger" className="gap-1"><AlertCircle className="h-3 w-3" aria-hidden /> {critical.length} kritik</Badge>}
          {warning.length > 0 && <Badge variant="warning" className="gap-1"><AlertTriangle className="h-3 w-3" aria-hidden /> {warning.length} uyarı</Badge>}
        </div>
      </div>

      <ul className="divide-y">
        {topIssues.map((iss, i) => {
          const isCritical = iss.severity === 'critical';
          const isWarning = iss.severity === 'warning' || iss.severity === 'major';
          const Icon = isCritical ? AlertCircle : isWarning ? AlertTriangle : CheckCircle2;
          // robots.txt onizlemeyle yazilir; dogrulanamayan kontrolun sorunu otomatik rota almaz
          const route = iss.fixRoute === 'auto_fix'
            ? (isUnverifiedCheck(audit, iss.checkId) ? null : isRobotsFixKey(iss.checkId) ? 'önizlemeli' : 'otomatik')
            : iss.fixRoute === 'snippet' ? 'sayfa SEO' : iss.fixRoute === 'images' ? 'görseller' : null;
          return (
            <li key={`${iss.checkId ?? iss.type}-${i}`} className="flex items-start gap-2.5 py-2">
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', isCritical ? 'text-danger' : isWarning ? 'text-warning' : 'text-muted-foreground')} aria-hidden />
              <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{iss.description || iss.type}</p>
              {route && <Badge variant="brand" className="shrink-0">{route}</Badge>}
            </li>
          );
        })}
      </ul>

      <Link href={siteHref(site.id, 'audit')} className="mt-3 inline-flex items-center gap-1 text-label font-medium text-brand hover:underline">
        {issues.length > topIssues.length ? `${issues.length} sorunun tamamını gör` : 'Site skoruna git'} <ArrowRight className="h-3 w-3" aria-hidden />
      </Link>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// OTOMATIK AKIS KONTROLU — Otomatik Akis sayfasi kullanir
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

  // 3 durum: durduruldu | yari otomatik | tam otomatik
  const stateKey = !autopilot ? 'paused' : isAuto ? 'auto' : 'manual';
  const config = {
    paused: {
      label: 'Durduruldu',
      icon: Pause,
      box: 'border-border bg-muted/30',
      chip: 'bg-muted text-muted-foreground',
      text: 'text-muted-foreground',
      desc: 'Otomatik akış kapalı. Yeni yazı üretilmiyor — açmak için sağdaki düğmeye bas.',
    },
    manual: {
      label: 'Yarı otomatik',
      icon: Eye,
      box: 'border-info/30 bg-info/5',
      chip: 'bg-info/15 text-info',
      text: 'text-info',
      desc: 'AI yazıları üretip takvime alır. Her yazı yayınlanmadan önce onayını bekler — e-posta ve panelden haber alırsın.',
    },
    auto: {
      label: 'Tam otomatik',
      icon: Rocket,
      box: 'border-brand/30 bg-brand/5',
      chip: 'bg-brand/15 text-brand',
      text: 'text-brand',
      // Sosyal paylasim modulu yok (API'de modul/route yok) — vaat edilmez
      desc: 'AI tüm akışı yönetir: üretim, görsel, şema ve yayın. Sen yalnızca haftalık raporu okursun.',
    },
  }[stateKey];
  const StateIcon = config.icon;

  return (
    <div className={cn('rounded-lg border p-4 transition-colors', config.box)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-[260px] flex-1 items-start gap-3">
          <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full', config.chip)}>
            <StateIcon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
              <span className={config.text}>{config.label}</span>
              {autopilot && (
                <Badge variant="success" className="gap-1">
                  <Activity className="h-3 w-3" aria-hidden /> Çalışıyor
                </Badge>
              )}
            </p>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{config.desc}</p>

            <div className="mt-3 flex max-w-fit items-center gap-1.5 rounded-full border bg-card/60 p-1" role="group" aria-label="Onay modu">
              <button
                type="button"
                onClick={() => setMode('manual_approve')}
                disabled={!autopilot || modeBusy}
                aria-pressed={autopilot && !isAuto}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-label font-semibold transition-all',
                  !autopilot && 'cursor-not-allowed opacity-40',
                  autopilot && !isAuto && 'bg-info text-white shadow-sm',
                  autopilot && isAuto && 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Eye className="h-3.5 w-3.5" aria-hidden /> Yarı otomatik
              </button>
              <button
                type="button"
                onClick={() => setMode('auto_publish')}
                disabled={!autopilot || modeBusy}
                aria-pressed={autopilot && isAuto}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-label font-semibold transition-all',
                  !autopilot && 'cursor-not-allowed opacity-40',
                  autopilot && isAuto && 'bg-brand text-white shadow-sm',
                  autopilot && !isAuto && 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Rocket className="h-3.5 w-3.5" aria-hidden /> Tam otomatik
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleAutopilot}
          disabled={autopilotBusy}
          aria-label={autopilot ? 'Akışı durdur' : 'Akışı aç'}
          aria-pressed={autopilot}
          title={autopilot ? 'Akışı durdur' : 'Akışı aç'}
          className={cn(
            'grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 transition-all duration-300',
            autopilotBusy && 'cursor-wait opacity-60',
            autopilot
              ? 'border-success/50 bg-success/10 text-success hover:border-success/70 hover:bg-success/20'
              : 'border-brand/40 bg-brand/10 text-brand hover:border-brand/60 hover:bg-brand/20',
          )}
        >
          <Power className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
