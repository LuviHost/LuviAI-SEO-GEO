"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Activity, FileText, BarChart3, Film, ClipboardList, Settings as SettingsIcon, FileBarChart } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsTab } from "@/components/analytics-tab";
import { SettingsTab } from "@/components/settings-tab";
import { VideoLab } from "@/components/video-lab";
import { SiteOverviewDashboard } from "@/components/site-overview-dashboard";
import { SiteReportPanel } from "@/components/site-report-panel";
import {
  AuditStepBody,
  CompetitorsStepBody,
  TopicsStepBody,
  ArticlesStepBody,
  CitationPanel,
  SnippetPanel,
} from "@/components/site-flow-stepper";

/**
 * Operations Panel — Faz 2 daily-use UI.
 *
 * IA prensibi (C plani — Stripe / Vercel / Linear pattern):
 *   - Setup (audit + rakip + topics + ilk makale) /onboarding sayfasinda yapilir
 *     ("Mission #1" — tek-sayfa wizard, lineer akis)
 *   - Bu sayfa setup tamamlandiktan SONRAKI gunluk kullanim icin
 *   - "Detayli Akis" tab i kaldirildi — anlami kalmadi (mission bitti)
 *
 * Tab yapisi (rolu net, ortusmesiz):
 *   - Saglik   = "Bugun durum nedir, ne yapmaliyim?"   (SiteOverviewDashboard)
 *   - Icerik   = "Hangi konular var, hangi makaleler uretildi?"  (Topics + Articles + Calendar)
 *   - Veri     = "Gorunurluk, trafik, AI atifi, rakipler, snippet"  (Audit + GSC + GA4 + Citation + Snippet + Competitors)
 *   - Video    = "TikTok / YouTube / Reels kisa video uretimi"   (VideoLab)
 *   - Rapor    = "Toplam performans raporu"   (SiteReportPanel)
 *   - Analytics = "Detayli analitik gosterge paneli"   (AnalyticsTab)
 *   - Ayarlar  = "Konfig, kanal baglantisi, agent re-run"   (SettingsTab)
 */

type TabId =
  | ""        // Saglik (default)
  | "content"
  | "data"
  | "videos"
  | "report"
  | "analytics"
  | "settings";

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }>; }> = [
  { id: "",          label: "Saglik",    icon: Activity },
  { id: "content",   label: "Icerik",    icon: FileText },
  { id: "data",      label: "Veri",      icon: BarChart3 },
  { id: "videos",    label: "Video",     icon: Film },
  { id: "report",    label: "Rapor",     icon: FileBarChart },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "settings",  label: "Ayarlar",   icon: SettingsIcon },
];

export default function SitePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const onboardingMode = searchParams.get("onboarding") === "running";
  const tabParam = (searchParams.get("tab") ?? "") as TabId;
  const tab: TabId = (TABS.some((t) => t.id === tabParam) ? tabParam : "") as TabId;

  const [site, setSite] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [queue, setQueue] = useState<any>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [publishTargets, setPublishTargets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const id = params.id as string;

  const refresh = async () => {
    try {
      const [s, a, q, ar, pt] = await Promise.all([
        api.getSite(id),
        api.getLatestAudit(id).catch(() => null),
        api.getTopicQueue(id).catch(() => null),
        api.listArticles(id).catch(() => []),
        api.listPublishTargets(id).catch(() => []),
      ]);
      setSite(s);
      setAudit(a);
      setQueue(q);
      setArticles(ar);
      setPublishTargets(pt ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [id]);
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);

  // Polling: onboarding chain veya inflight makale varsa 5sn de bir guncelle
  const statusOnboarding = site ? !["ACTIVE", "PAUSED", "ERROR"].includes(site.status) : false;
  const recentlyCreated = site?.createdAt ? Date.now() - new Date(site.createdAt).getTime() < 10 * 60_000 : false;
  const auditMissing = !audit;
  const brainCompetitorsMissing = !site?.brain || !(site.brain?.competitors?.length);
  const chainStillRunning = recentlyCreated && (auditMissing || brainCompetitorsMissing);
  const isOnboardingActive = statusOnboarding || chainStillRunning;
  const hasInflightArticle = articles.some((a) => a?.status === "GENERATING" || a?.status === "EDITING");
  const needsPolling = onboardingMode || isOnboardingActive || hasInflightArticle;

  useEffect(() => {
    if (!needsPolling) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [needsPolling, id]);

  // Hash scroll: ?tab=data#citation gibi URL'lerde sayfa yüklenince ilgili section'a kaydır.
  useEffect(() => {
    if (loading) return;
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!hash) return;
    const t1 = window.setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
    const t2 = window.setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 700);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [loading, tab]);

  const switchTab = (next: TabId) => {
    router.push(`/sites/${id}${next ? `?tab=${next}` : ""}` as any);
  };

  if (loading || !site) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-brand inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Dashboard
        </Link>
        <h1 className="text-3xl font-bold mt-2">{site.name}</h1>
        <a
          href={site.url}
          target="_blank"
          rel="noopener"
          className="text-sm text-muted-foreground hover:text-brand inline-flex items-center gap-1 mt-1"
        >
          {site.url} <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Tab bar — yatay scroll mobile uyumlu */}
      <div className="flex items-center gap-1 border-b overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-thin">
        {TABS.map(({ id: tid, label, icon: Icon }) => {
          const active = tid === tab;
          return (
            <button
              key={tid || "health"}
              onClick={() => switchTab(tid)}
              className={[
                "shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                active
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      {tab === "" && (
        <SiteOverviewDashboard
          site={site}
          audit={audit}
          articles={articles}
          publishTargets={publishTargets}
          onRefresh={refresh}
        />
      )}

      {tab === "content" && (
        <ContentTab
          site={site}
          queue={queue}
          articles={articles}
          siteId={id}
          onRefresh={refresh}
          onboardingMode={onboardingMode || isOnboardingActive}
        />
      )}

      {tab === "data" && (
        <DataTab
          site={site}
          audit={audit}
          siteId={id}
          onRefresh={refresh}
          onboardingMode={onboardingMode || isOnboardingActive}
        />
      )}

      {tab === "videos" && <VideoLab siteId={id} />}
      {tab === "report" && <SiteReportPanel siteId={id} site={site} />}
      {tab === "analytics" && <AnalyticsTab siteId={id} site={site} />}
      {tab === "settings" && <SettingsTab siteId={id} onRefresh={refresh} />}
    </div>
  );
}

/**
 * Icerik tab i — onerilen konular + uretilen makaleler.
 * ArticlesStepBody zaten ContentCalendarPanel iceriyor (scheduled visualization),
 * o yuzden ayri "Takvim" tab ina gerek yok.
 */
function ContentTab({
  site, queue, articles, siteId, onRefresh, onboardingMode,
}: {
  site: any;
  queue: any;
  articles: any[];
  siteId: string;
  onRefresh: () => void;
  onboardingMode: boolean;
}) {
  return (
    <div className="space-y-8">
      <section>
        <SectionHeader
          title="Onerilen Konular"
          subtitle="AI topic engine taraf indan uretilen makale onerileri. Surukleyerek takvime al."
          icon={FileText}
        />
        <TopicsStepBody
          queue={queue}
          articles={articles}
          siteId={siteId}
          onRefresh={onRefresh}
          onboardingMode={onboardingMode}
        />
      </section>

      <section>
        <SectionHeader
          title="Makaleler & Takvim"
          subtitle="Uretilen ve planlanmis makaleler. Takvimde sosyal kanal toggle u var."
          icon={ClipboardList}
        />
        <ArticlesStepBody
          articles={articles}
          siteId={siteId}
          onRefresh={onRefresh}
        />
      </section>
    </div>
  );
}

/**
 * Veri tab i — analitik, AI gorunurluk, baglantili hesaplar.
 * Audit (site skor + fix), GSC, GA4, Citation, Snippet, Competitors.
 */
function DataTab({
  site, audit, siteId, onRefresh, onboardingMode,
}: {
  site: any;
  audit: any;
  siteId: string;
  onRefresh: () => void;
  onboardingMode: boolean;
}) {
  const gscConnected = !!site?.gscConnectedAt && !!site?.gscPropertyUrl;
  const ga4Connected = !!site?.gaConnectedAt && !!site?.gaPropertyId;

  return (
    <div className="space-y-8">
      <section id="audit" className="scroll-mt-24">
        <SectionHeader
          title="Site Skoru (14 SEO + GEO Kontrol)"
          subtitle="HTTPS, robots.txt, sitemap, schema, meta, h1, alt, hreflang... Otomatik düzeltilebilenler one-click."
          icon={BarChart3}
        />
        <AuditStepBody
          audit={audit}
          siteId={siteId}
          onRefresh={onRefresh}
          onboardingMode={onboardingMode}
        />
      </section>

      <section id="citation" className="scroll-mt-24">
        <SectionHeader
          title="AI Görünürlük Testi (Manuel)"
          subtitle="Claude / Gemini / ChatGPT / Perplexity'de 'sitenizi' soran sorgular — şimdi test et."
          icon={Activity}
        />
        <CitationPanel siteId={siteId} />
      </section>

      <section id="snippet" className="scroll-mt-24">
        <SectionHeader
          title="Snippet Üretici (Sayfa Bazlı)"
          subtitle="Bir URL gir, AI title/description/FAQ önerileri üretip uygula."
          icon={FileText}
        />
        <SnippetPanel siteId={siteId} />
      </section>

      <section id="competitors" className="scroll-mt-24">
        <SectionHeader
          title="Rakipler"
          subtitle="AI ile tespit edilen rakipler. SERP + içerik analizi için."
          icon={Activity}
        />
        <CompetitorsStepBody
          siteId={siteId}
          initial={(site?.brain?.competitors ?? []) as any}
          onChanged={onRefresh}
          onboardingMode={onboardingMode}
        />
      </section>

      {/* GSC / GA4 — sadece bağlantı durumu özet kartı, yönetim Ayarlar'da */}
      <section id="connections" className="scroll-mt-24">
        <SectionHeader
          title="Bağlı Veri Kaynakları"
          subtitle="Detaylı yönetim için Ayarlar > Veri Bağlantıları sekmesine git."
          icon={BarChart3}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className={`rounded-xl border p-4 ${gscConnected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`h-2 w-2 rounded-full ${gscConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Google Search Console</span>
                </div>
                <p className="text-sm font-semibold mt-0.5">
                  {gscConnected ? 'Bağlı ✓' : 'Bağlı değil'}
                </p>
                {gscConnected && (
                  <p className="text-[11px] text-muted-foreground mt-1 truncate">{site.gscPropertyUrl}</p>
                )}
                {!gscConnected && (
                  <p className="text-[11px] text-muted-foreground mt-1">Arama trafiği + impression + CTR için bağla.</p>
                )}
              </div>
              <a
                href={`/sites/${siteId}?tab=settings`}
                className="text-xs text-brand hover:underline whitespace-nowrap"
              >
                {gscConnected ? 'Yönet →' : 'Bağla →'}
              </a>
            </div>
          </div>

          <div className={`rounded-xl border p-4 ${ga4Connected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`h-2 w-2 rounded-full ${ga4Connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Google Analytics 4</span>
                </div>
                <p className="text-sm font-semibold mt-0.5">
                  {ga4Connected ? 'Bağlı ✓' : 'Bağlı değil'}
                </p>
                {ga4Connected && (
                  <p className="text-[11px] text-muted-foreground mt-1 truncate">Property: {site.gaPropertyId}</p>
                )}
                {!ga4Connected && (
                  <p className="text-[11px] text-muted-foreground mt-1">Bounce, oturum, conversion için bağla.</p>
                )}
              </div>
              <a
                href={`/sites/${siteId}?tab=settings`}
                className="text-xs text-brand hover:underline whitespace-nowrap"
              >
                {ga4Connected ? 'Yönet →' : 'Bağla →'}
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionHeader({
  title, subtitle, icon: Icon,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <div className="h-9 w-9 rounded-lg bg-brand/10 grid place-items-center shrink-0">
        <Icon className="h-4 w-4 text-brand" />
      </div>
      <div>
        <h2 className="font-semibold text-base sm:text-lg leading-tight">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}
