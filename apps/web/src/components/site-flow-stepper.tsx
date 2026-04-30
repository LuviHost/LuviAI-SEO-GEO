'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  CheckCircle2, ChevronDown, Circle, ExternalLink, Plus, Trash2,
  BarChart3, Link2, Unlink, Activity, Sparkles, FileText, Send, Share2, Calendar,
  Twitter as TwitterIcon, Linkedin as LinkedinIcon, Instagram as InstagramIcon,
  Facebook as FacebookIcon, Youtube as YoutubeIcon, Globe as GlobeIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PipelineProgress, PIPELINE_STEPS } from '@/components/pipeline-progress';
import { AiKeysPanel } from '@/components/ai-keys-panel';

type StepStatus = 'pending' | 'auto-running' | 'done' | 'skipped';

interface StepDef {
  id: string;
  n: number;
  title: string;
  status: StepStatus;
  hint: string;
  optional?: boolean;
}


// ──────────────────────────────────────────────────────────────────────
// Sosyal kanal tip → ikon + isim haritası. Backend channel.type değerleri
// (LINKEDIN_PERSONAL, X_TWITTER, INSTAGRAM_BUSINESS vb.) kart UI'sinde
// kullanıcı dostu Türkçe ifadelere ve gerçek logolara dönüşür.
// ──────────────────────────────────────────────────────────────────────
function getChannelMeta(type: string): {
  Icon: any;
  shortName: string;
  shareLabel: string;
  brandClass: string;
} {
  const t = (type || '').toUpperCase();
  if (t.startsWith('LINKEDIN')) {
    return {
      Icon: LinkedinIcon,
      shortName: 'LinkedIn',
      shareLabel: "LinkedIn'de paylaşılsın",
      brandClass: 'text-[#0A66C2]',
    };
  }
  if (t.startsWith('X_') || t === 'X' || t.startsWith('TWITTER')) {
    return {
      Icon: TwitterIcon,
      shortName: 'X',
      shareLabel: "X'te (Twitter) paylaşılsın",
      brandClass: 'text-foreground',
    };
  }
  if (t.startsWith('INSTAGRAM')) {
    return {
      Icon: InstagramIcon,
      shortName: 'Instagram',
      shareLabel: "Instagram'da paylaşılsın",
      brandClass: 'text-[#E4405F]',
    };
  }
  if (t.startsWith('FACEBOOK')) {
    return {
      Icon: FacebookIcon,
      shortName: 'Facebook',
      shareLabel: "Facebook'ta paylaşılsın",
      brandClass: 'text-[#1877F2]',
    };
  }
  if (t.startsWith('YOUTUBE')) {
    return {
      Icon: YoutubeIcon,
      shortName: 'YouTube',
      shareLabel: "YouTube'da paylaşılsın",
      brandClass: 'text-[#FF0000]',
    };
  }
  return {
    Icon: GlobeIcon,
    shortName: type || 'Kanal',
    shareLabel: "Bu kanalda paylaşılsın",
    brandClass: 'text-muted-foreground',
  };
}

export function SiteFlowStepper({
  site, audit, queue, articles, onRefresh, onboardingMode,
}: {
  site: any;
  audit: any;
  queue: any;
  articles: any[];
  onRefresh: () => void;
  onboardingMode: boolean;
}) {
  const search = useSearchParams();
  const router = useRouter();
  const initialStep = search.get('step');

  const steps: StepDef[] = [
    {
      id: 'audit', n: 1, title: 'Site Skoru',
      status: audit ? 'done' : (onboardingMode ? 'auto-running' : 'pending'),
      hint: audit ? `${audit.overallScore ?? 0}/100` : 'Tarama bekleniyor',
    },
    {
      id: 'competitors', n: 2, title: 'Rakipler',
      status: site.brain?.competitors?.length ? 'done' : (onboardingMode ? 'auto-running' : 'pending'),
      hint: site.brain?.competitors?.length ? `${site.brain.competitors.length} rakip` : 'AI tespit ediyor',
    },
    // NOT: GSC + Google Analytics step'leri buradan kaldirildi — yukaridaki
    // "Hesaplarini bagla" tavsiye banner'i ayni baglanti islerini zaten icerir,
    // alt akis kalabaligi yapmasin diye burada tekrar gosterilmiyor.
    // NOT: 'social' (Sosyal Kanallar) adımı Ayarlar sekmesine taşındı.
    // 'social-calendar' kaldırıldı — kanal seçimi artık takvim hücresindeki ikonlarla.
    {
      id: 'topics', n: 3, title: 'Önerilen Makaleler',
      status: queue ? 'done' : (onboardingMode ? 'auto-running' : 'pending'),
      hint: queue ? `${(queue.tier1Topics ?? []).length} öneri` : 'Topic engine bekleniyor',
    },
    {
      id: 'articles', n: 4, title: 'Makaleler',
      status: articles.length > 0 ? 'done' : 'pending',
      hint: articles.length > 0 ? `${articles.length} makale` : 'İlk makale ücretsiz',
    },
  ];

  // Drag-drop tutorial: 3 koşul birden bittiğinde bir kez göster.
  //   - Site Skoru tamamlandı (audit dolu)
  //   - AI Rakipler tespit edildi (brain.competitors >= 1)
  //   - Önerilen Makaleler hazır (queue.tier1Topics >= 1)
  // localStorage flag: luviai_drag_drop_tutorial_seen:<siteId> — bir kez görülünce tekrar açılmaz.
  const [tutorialOpen, setTutorialOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flagKey = `luviai_drag_drop_tutorial_seen:${site.id}`;
    if (window.localStorage.getItem(flagKey) === '1') return;
    const auditDone = !!audit;
    const competitorsDone = (site?.brain?.competitors?.length ?? 0) > 0;
    const topicsDone = ((queue?.tier1Topics as any[] | undefined)?.length ?? 0) > 0;
    if (auditDone && competitorsDone && topicsDone) setTutorialOpen(true);
  }, [audit, site?.brain?.competitors, queue?.tier1Topics, site.id]);

  const closeTutorial = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`luviai_drag_drop_tutorial_seen:${site.id}`, '1');
    }
    setTutorialOpen(false);
  };

  const firstIncomplete = steps.find((s) => s.status !== 'done' && !s.optional)?.id ?? 'audit';
  // Multi-open: aktif step ID'leri set olarak tutulur — birini acmak digerini kapatmaz.
  // Boylece "Makaleler" + "Sosyal Takvim" ikisi birden acik kalip drag-drop calisir.
  // Onboarding modunda Site Skoru + Rakipler default acik geliyor (ikisi de chain calisirken
  // ilk gosterilmesi gereken kartlar).
  const [openSet, setOpenSet] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (initialStep && steps.find((s) => s.id === initialStep)) {
      initial.add(initialStep);
    } else {
      initial.add(firstIncomplete);
    }
    if (onboardingMode) {
      initial.add('audit');
      initial.add('competitors');
      initial.add('topics');
    }
    return initial;
  });
  const [userTouched, setUserTouched] = useState<boolean>(!!initialStep);
  // Drag aktifken tum step'leri zorla aciyoruz (drop hedefi DOM'da olmali).
  // Drop bitince eski state'e geri donuyoruz.
  const [draggingPreOpen, setDraggingPreOpen] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (initialStep && steps.find((s) => s.id === initialStep)) {
      setOpenSet((prev) => new Set([...prev, initialStep]));
      setUserTouched(true);
    }
  }, [initialStep]);

  // Auto-advance: kullanici manuel toggle yapmadiysa ve onboarding modundaysa,
  // tamamlanmis adimdan bir sonrakine otomatik gec — Site Skoru + Rakipler her zaman acik kalir.
  useEffect(() => {
    if (userTouched) return;
    if (!onboardingMode) return;
    if (openSet.has(firstIncomplete) && openSet.has('audit') && openSet.has('competitors') && openSet.has('topics')) return;
    setOpenSet(new Set([firstIncomplete, 'audit', 'competitors', 'topics']));
  }, [firstIncomplete, onboardingMode, userTouched, openSet]);

  // Drag-aware: makale veya kuyruk kartı surukluyorsa tum panelleri zorla ac.
  // Drop bitince eski state'e gec.
  useEffect(() => {
    const onDragStart = (e: DragEvent) => {
      const t = e.dataTransfer?.types ?? [];
      // Sadece bizim drag'lerimiz (article/queue) — image/text dragi tetiklemesin
      if (!Array.from(t).some((tt) => tt === 'application/json' || tt === 'text/plain')) return;
      setDraggingPreOpen(new Set(openSet));
      const allIds = new Set(steps.map((s) => s.id));
      setOpenSet(allIds);
    };
    const onDragEnd = () => {
      if (draggingPreOpen) {
        setOpenSet(draggingPreOpen);
        setDraggingPreOpen(null);
      }
    };
    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('dragend', onDragEnd);
    document.addEventListener('drop', onDragEnd);
    return () => {
      document.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('dragend', onDragEnd);
      document.removeEventListener('drop', onDragEnd);
    };
  }, [openSet, draggingPreOpen, steps]);

  const toggle = (id: string) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      // URL state — son acilan id'yi yaz (geriye uyumluluk)
      const url = new URL(window.location.href);
      const last = Array.from(next).pop();
      if (last) url.searchParams.set('step', last);
      else url.searchParams.delete('step');
      window.history.replaceState({}, '', url.toString());
      return next;
    });
    setUserTouched(true);
  };

  // Hesap baglama daveti: audit + brain hazir, ama hicbir hesap (GSC/GA/Sosyal) bagli degilse
  const noAccountsConnected =
    !site.gscConnectedAt && !site.gaConnectedAt;
  const showConnectInvite =
    audit && site.brain?.competitors?.length && noAccountsConnected;

  return (
    <div className="space-y-3">
      {showConnectInvite && (
        <ConnectAccountsInvite
          onOpenStep={(id) => {
            setUserTouched(true);
            setOpenSet((prev) => new Set([...prev, id]));
            const url = new URL(window.location.href);
            url.searchParams.set('step', id);
            window.history.replaceState({}, '', url.toString());
          }}
        />
      )}
      {steps.map((s) => (
        <StepCard
          key={s.id}
          step={s}
          isOpen={openSet.has(s.id)}
          onToggle={() => toggle(s.id)}
        >
          {s.id === 'audit' && <AuditStepBody audit={audit} siteId={site.id} onRefresh={onRefresh} onboardingMode={onboardingMode} />}
          {s.id === 'competitors' && <CompetitorsStepBody siteId={site.id} initial={site.brain?.competitors ?? []} onChanged={onRefresh} onboardingMode={onboardingMode} />}
          {s.id === 'gsc' && <GscStepBody site={site} onChanged={onRefresh} />}
          {s.id === 'ga4' && <Ga4StepBody site={site} onChanged={onRefresh} />}
          {s.id === 'topics' && <TopicsStepBody queue={queue} articles={articles} siteId={site.id} onRefresh={onRefresh} onboardingMode={onboardingMode} />}
          {s.id === 'articles' && <ArticlesStepBody articles={articles} siteId={site.id} onRefresh={onRefresh} />}
        </StepCard>
      ))}

      <DigerSection siteId={site.id} />

      <DragDropTutorialModal open={tutorialOpen} onClose={closeTutorial} />
    </div>
  );
}

function ConnectAccountsInvite({ onOpenStep }: { onOpenStep: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-brand/30 bg-gradient-to-br from-brand/5 to-transparent p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-brand/10 grid place-items-center shrink-0">
          <Link2 className="h-4 w-4 text-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Hesaplarini bagla — opsiyonel ama tavsiye edilir</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Site analizin hazir. Makale uretmeden once GSC/GA bagla → topic engine gercek arama verini kullansin.
            Sosyal kanal ekle → makaleler otomatik LinkedIn/X'te paylasilsin.
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Button size="sm" variant="outline" onClick={() => onOpenStep('gsc')}>
          <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> GSC
        </Button>
        <Button size="sm" variant="outline" onClick={() => onOpenStep('ga4')}>
          <Activity className="h-3.5 w-3.5 mr-1.5" /> GA4
        </Button>
        <Button size="sm" variant="outline" onClick={() => onOpenStep('social')}>
          <Share2 className="h-3.5 w-3.5 mr-1.5" /> Sosyal
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tek kart - başlık + ikon + accordion content
// ──────────────────────────────────────────────────────────────────────
function StepCard({
  step, isOpen, onToggle, children,
}: {
  step: StepDef;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const statusIcon = (() => {
    if (step.status === 'done') return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    if (step.status === 'auto-running') {
      return <span className="h-5 w-5 grid place-items-center"><span className="h-2.5 w-2.5 bg-brand rounded-full animate-pulse" /></span>;
    }
    if (step.status === 'skipped') return <Circle className="h-5 w-5 text-muted-foreground/40" />;
    return (
      <span className="h-6 w-6 rounded-full bg-muted text-foreground/70 grid place-items-center text-[11px] font-semibold">
        {step.n}
      </span>
    );
  })();

  const statusLabel = (() => {
    if (step.status === 'done') return 'Tamam';
    if (step.status === 'auto-running') return 'Çalışıyor';
    if (step.status === 'skipped') return step.optional ? 'Opsiyonel' : 'Atlandı';
    return 'Bekliyor';
  })();

  return (
    <Card className={isOpen ? 'border-brand/40 shadow-sm' : ''}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {statusIcon}
          <div className="min-w-0">
            <div className="font-semibold text-sm sm:text-base">{step.title}</div>
            <div className="text-xs text-muted-foreground truncate">{step.hint}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={step.status === 'done' ? ('success' as any) : 'outline'}>
            {statusLabel}
          </Badge>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      <CardContent
        className={`pt-0 px-4 pb-5 border-t border-border/60 mt-1 ${isOpen ? '' : 'hidden'}`}
      >
        <div className="pt-4">{children}</div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 1 — Site Skoru
// ──────────────────────────────────────────────────────────────────────
function AuditStepBody({
  audit, siteId, onRefresh, onboardingMode,
}: {
  audit: any;
  siteId: string;
  onRefresh: () => void;
  onboardingMode?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      await api.runAuditNow(siteId);
      toast.success('Site skoru güncellendi');
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  if (!audit) {
    // Onboarding modunda chain otomatik calisiyor — manuel buton kafa karistirir,
    // direkt progress goster.
    if (onboardingMode || running) {
      return (
        <PipelineProgress
          title="Site skoru otomatik hesaplaniyor"
          steps={PIPELINE_STEPS.audit}
          running
        />
      );
    }
    return (
      <div className="space-y-3">
        <div className="text-center py-6">
          <p className="text-sm text-muted-foreground mb-3">Henüz site skoru hesaplanmadı.</p>
          <Button onClick={run}>Skoru Hesapla</Button>
          <p className="text-xs text-muted-foreground mt-3">~30 sn — 14 SEO + GEO kontrolü</p>
        </div>
      </div>
    );
  }

  const issues = audit.issues ?? [];
  const fixable = issues.filter((i: any) => i.fixable);
  const checks = audit.checks ?? {};

  const applyFix = async () => {
    setFixing(true);
    try {
      await api.applyAutoFix(siteId, ['sitemap', 'robots', 'llms']);
      toast.success("Auto-fix queue'ya eklendi");
      setTimeout(() => { onRefresh(); setFixing(false); }, 25000);
    } catch (err: any) {
      toast.error(err.message);
      setFixing(false);
    }
  };

  return (
    <div className="space-y-4">
      {(running || fixing) && (
        <PipelineProgress
          title={running ? 'Site skoru yeniden hesaplanıyor' : 'Otomatik düzeltme uygulanıyor'}
          steps={running ? PIPELINE_STEPS.audit : PIPELINE_STEPS.autoFix}
          running={running || fixing}
        />
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 text-center">
          <div className="text-3xl font-bold text-brand">{audit.overallScore}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Site Skoru / 100</div>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <div className="text-3xl font-bold">{audit.geoScore ?? '-'}</div>
          <div className="text-xs text-muted-foreground mt-0.5">AI Search / 100</div>
        </div>
        <div className="rounded-lg border p-3 text-center">
          {(() => {
            const failedCount = Object.values(checks).filter((v: any) => v?.name && (v?.score ?? 0) < 100).length;
            const totalCount = Object.values(checks).filter((v: any) => v?.name).length;
            return (
              <>
                <div className="text-3xl font-bold text-red-500">{failedCount}<span className="text-base text-muted-foreground font-normal">/{totalCount}</span></div>
                <div className="text-xs text-muted-foreground mt-0.5">Sorunlu Kontrol ({issues.length} bulgu)</div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Kritik bulgular — açık liste (artık accordion'a saklanmıyor) */}
      {issues.length > 0 && (() => {
        const critical = issues.filter((i: any) => i.severity === 'critical');
        const warnings = issues.filter((i: any) => i.severity === 'warning');
        const top = [...critical, ...warnings].slice(0, 6);
        return (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-semibold">
                🔴 {critical.length} kritik · ⚠ {warnings.length} uyarı bulundu
              </p>
              {fixable.length > 0 && (
                <Button size="sm" onClick={applyFix} disabled={fixing}>
                  ⚡ {fixable.length} sorunu otomatik düzelt
                </Button>
              )}
            </div>
            <ul className="space-y-1.5 text-xs">
              {top.map((i: any, idx: number) => (
                <li key={idx} className="flex items-start gap-2 leading-relaxed">
                  <span className={i.severity === 'critical' ? 'text-red-500' : 'text-yellow-500'}>
                    {i.severity === 'critical' ? '●' : '○'}
                  </span>
                  <span className="flex-1">
                    {i.description}
                    {i.fixable && <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 rounded px-1 py-0.5 font-semibold">otomatik</span>}
                  </span>
                </li>
              ))}
              {issues.length > top.length && (
                <li className="text-muted-foreground italic pl-4">+{issues.length - top.length} ek bulgu…</li>
              )}
            </ul>
          </div>
        );
      })()}

      {/* 14 nokta kontrol listesi — varsayilan olarak acik, her satirda durum */}
      <div className="rounded-lg border">
        <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
          <span className="text-sm font-semibold">14 SEO + GEO kontrol noktası</span>
          <span className="text-[11px] text-muted-foreground">
            ✓ Var · ✗ Yok / Eksik
          </span>
        </div>
        <div className="divide-y text-sm">
          {Object.entries(checks).filter(([, v]: any) => v?.name && v?.id !== 'ai_citations').map(([k, v]: any) => {
            const firstIssue = Array.isArray(v.issues) && v.issues.length > 0 ? v.issues[0] : null;
            const fixable = Array.isArray(v.issues) && v.issues.some((i: any) => i.fixable);
            const statusColor = v.score >= 80 ? 'text-green-500' : v.score >= 50 ? 'text-yellow-500' : 'text-red-500';
            return (
              <div key={k} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    {v.found && v.valid ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                    ) : v.found ? (
                      <Circle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                    ) : (
                      <Circle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{v.name}</span>
                        <span className={`text-[11px] uppercase tracking-wide font-semibold ${
                          v.found && v.valid ? 'text-green-600' : v.found ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {v.found && v.valid ? 'VAR' : v.found ? 'EKSİK' : 'YOK'}
                        </span>
                        {fixable && (
                          <span className="text-[10px] uppercase tracking-wide bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 rounded px-1.5 py-0.5 font-semibold">
                            otomatik
                          </span>
                        )}
                      </div>
                      {firstIssue && (
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {firstIssue.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className={`font-mono text-xs font-bold shrink-0 ${statusColor}`}>{v.score}/100</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Citation: artık otomatik audit'te çalışıyor — eski paneli de manuel re-run için bırakıyoruz */}
      {checks.aiCitations?.providers && (
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-semibold">AI Arama Görünürlüğü (otomatik)</p>
              <p className="text-xs text-muted-foreground">Claude · Gemini · ChatGPT · Perplexity</p>
            </div>
            <span className="text-2xl font-bold text-brand">{checks.aiCitations.score ?? 0}/100</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {(checks.aiCitations.providers as any[]).map((p) => (
              <div key={p.provider} className="rounded-md border p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate">{p.label}</span>
                  <span className={`text-sm font-bold ${
                    p.score === null ? 'text-muted-foreground' :
                    p.score >= 60 ? 'text-green-500' :
                    p.score >= 30 ? 'text-yellow-500' : 'text-red-500'
                  }`}>
                    {p.available && p.score !== null ? p.score : '—'}
                  </span>
                </div>
                {!p.available && p.reason && (
                  <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{p.reason}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <CitationPanel siteId={siteId} />

      <AiKeysPanel siteId={siteId} />

      <SnippetPanel siteId={siteId} />

      <div className="flex justify-end pt-2">
        <Button size="sm" variant="outline" onClick={run} disabled={running || fixing}>
          {running ? 'Hesaplanıyor…' : 'Skoru Yenile'}
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// AI Citation Panel — gerçek LLM probe sonuçları
// ──────────────────────────────────────────────────────────────────────
function CitationPanel({ siteId }: { siteId: string }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const [runAt, setRunAt] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      const res = await api.runCitationTest(siteId);
      setResults(res.results ?? []);
      setRunAt(res.runAt ?? null);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const colorFor = (s: number | null) => {
    if (s === null) return 'text-muted-foreground';
    if (s >= 60) return 'text-green-500';
    if (s >= 30) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold">AI Citation Testi</p>
          <p className="text-xs text-muted-foreground mt-0.5">Site brain AEO/GEO sorularını LLM'lere sorar — cevapta site URL'i veya marka adı geçiyor mu? URL geçerse 100 puan, sadece marka adı geçerse 50 puan/probe.</p>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={running}>
          {running ? 'Test ediliyor…' : 'AI Testini Çalıştır'}
        </Button>
      </div>

      {results && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {results.map((r: any) => (
              <div key={r.provider} className="rounded-md border p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{r.label}</span>
                  <span className={`text-lg font-bold ${colorFor(r.score)}`}>
                    {r.score === null ? '—' : `${r.score}`}
                  </span>
                </div>
                {r.reason && <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{r.reason}</p>}
                {r.probes?.length > 0 && (
                  <details className="mt-1.5">
                    <summary className="text-[11px] cursor-pointer text-muted-foreground">{r.probes.length} probe</summary>
                    <ul className="mt-1.5 space-y-1.5 text-[11px]">
                      {r.probes.map((p: any, i: number) => (
                        <li key={i} className="border-l-2 pl-2" style={{ borderColor: p.cited ? '#22c55e' : p.brandMentioned ? '#eab308' : '#ef4444' }}>
                          <p className="font-medium truncate">{p.cited ? '✓ URL' : p.brandMentioned ? '~ marka' : '✗ yok'} — {p.query}</p>
                          {p.excerpt && <p className="text-muted-foreground mt-0.5 line-clamp-2">{p.excerpt}</p>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
          {runAt && <p className="text-[11px] text-muted-foreground">Son test: {new Date(runAt).toLocaleString('tr-TR')}</p>}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Snippet Panel — D1 (AI üretip kullanıcıya copy-paste verir)
// ──────────────────────────────────────────────────────────────────────
function SnippetPanel({ siteId }: { siteId: string }) {
  const [loading, setLoading] = useState(false);
  const [pageUrl, setPageUrl] = useState('');
  const [snippets, setSnippets] = useState<any[] | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<any | null>(null);
  const [staticPreview, setStaticPreview] = useState<any | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [writeResult, setWriteResult] = useState<any | null>(null);

  const generate = async () => {
    setLoading(true);
    setApplyResult(null);
    try {
      const res = await api.getSnippets(siteId, pageUrl || undefined);
      setSnippets(res.snippets ?? []);
      setResolvedUrl(res.pageUrl ?? null);
      if ((res.snippets ?? []).length === 0) toast.info('Bu sayfa için eksik on-page tag bulunamadı');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!snippets || snippets.length === 0) return;
    setApplying(true);
    try {
      const res = await api.applySnippets(siteId, snippets);
      setApplyResult(res);
      if (res.ok) toast.success(`${res.applied.length} alan WP'ye yazıldı (${res.adapter})`);
      else toast.error(res.skipped?.[0]?.reason ?? 'Otomatik yazma başarısız');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setApplying(false);
    }
  };

  const previewStatic = async () => {
    if (!snippets || snippets.length === 0 || !resolvedUrl) return;
    setPreviewing(true);
    setWriteResult(null);
    try {
      const res = await api.previewStaticWrite(siteId, resolvedUrl, snippets);
      setStaticPreview(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPreviewing(false);
    }
  };

  const writeStatic = async () => {
    if (!snippets || !resolvedUrl) return;
    if (!confirm('Sayfa HTML\'i overwrite edilecek. Devam edilsin mi?')) return;
    setWriting(true);
    try {
      const res = await api.writeStatic(siteId, resolvedUrl, snippets);
      setWriteResult(res);
      if (res.ok) toast.success(`${res.applied?.length ?? 0} değişiklik yazıldı (${res.adapter})`);
      else toast.error(res.error ?? 'Yazılamadı');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setWriting(false);
    }
  };

  const copy = async (idx: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(idx);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error('Kopyalanamadı');
    }
  };

  const labelFor = (type: string) => ({
    meta_title: 'Meta Title',
    meta_description: 'Meta Description',
    canonical: 'Canonical URL',
    open_graph: 'Open Graph',
    twitter_card: 'Twitter Card',
    jsonld_article: 'JSON-LD Article',
    jsonld_organization: 'JSON-LD Organization',
    jsonld_breadcrumb: 'JSON-LD Breadcrumb',
    h1: 'H1 Etiketi',
  } as Record<string, string>)[type] ?? type;

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">On-Page Snippet Üretici</p>
          <p className="text-xs text-muted-foreground mt-0.5">Eksik canonical, meta description, OG tag, JSON-LD vb. için AI ile snippet üretir. Sayfanı bozmadan kendi panelinden yapıştırırsın (Yoast custom field, Webflow Page Settings, statik HTML <code>&lt;head&gt;</code> vb.).</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2 flex-wrap">
        <Input placeholder="Sayfa URL (boşsa anasayfa)" value={pageUrl} onChange={e => setPageUrl(e.target.value)} className="flex-1 min-w-[260px]" />
        <Button size="sm" onClick={generate} disabled={loading}>
          {loading ? 'Üretiliyor…' : 'Snippet Üret'}
        </Button>
      </div>

      {snippets && snippets.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
          <div className="text-xs">
            <p className="font-medium">Otomatik yazım (deneysel)</p>
            <p className="text-muted-foreground mt-0.5">
              WordPress (Yoast/RankMath), Webflow veya Shopify default target'ı varsa otomatik yazar.{' '}
              <Link href={`/sites/${siteId}?tab=settings`} className="underline text-blue-600 hover:text-blue-700">
                Publish target ekle/düzenle →
              </Link>
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={apply} disabled={applying}>
            {applying ? 'Yazılıyor…' : 'Otomatik Yaz'}
          </Button>
        </div>
      )}

      {applyResult && (
        <div className={`mt-2 rounded-md border p-2.5 text-xs ${applyResult.ok ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
          <p className="font-medium">{applyResult.ok ? '✓ Yazıldı' : '✗ Yazılamadı'} — adapter: {applyResult.adapter}</p>
          {applyResult.applied?.length > 0 && (
            <p className="text-muted-foreground mt-1">Uygulanan: {applyResult.applied.join(', ')}</p>
          )}
          {applyResult.skipped?.length > 0 && (
            <ul className="text-muted-foreground mt-1 list-disc list-inside">
              {applyResult.skipped.map((s: any, i: number) => (<li key={i}>{s.field}: {s.reason}</li>))}
            </ul>
          )}
        </div>
      )}

      {snippets && snippets.length > 0 && resolvedUrl && (
        <div className="mt-3 rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs">
              <p className="font-medium">Statik HTML auto-write (FTP/SFTP/cPanel için)</p>
              <p className="text-muted-foreground mt-0.5">
                Önce "Önizle" — sayfanın <code>&lt;head&gt;</code>'ine snippet'ler ekleniyor, diff gösterilir. Onay sonrası canlı dosya overwrite.{' '}
                <Link href={`/sites/${siteId}?tab=settings`} className="underline text-orange-700 hover:text-orange-800">
                  FTP/SFTP/cPanel target ekle →
                </Link>
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={previewStatic} disabled={previewing || writing}>
                {previewing ? 'Önizleniyor…' : 'Önizle'}
              </Button>
              <Button size="sm" onClick={writeStatic} disabled={!staticPreview || writing}>
                {writing ? 'Yazılıyor…' : 'Onayla ve Yaz'}
              </Button>
            </div>
          </div>

          {staticPreview && (
            <div className="mt-2 space-y-2">
              <p className="text-[11px]">
                Uygulanacak: <span className="font-mono text-green-600">{staticPreview.applied?.join(', ') || '(yok)'}</span>
                {staticPreview.skipped?.length > 0 && <> · atlanacak: <span className="font-mono text-yellow-600">{staticPreview.skipped.map((s: any) => s.type).join(', ')}</span></>}
              </p>
              <details className="text-[11px]">
                <summary className="cursor-pointer">Head diff göster</summary>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  <div>
                    <p className="font-medium mb-1">Eski &lt;head&gt;</p>
                    <pre className="bg-muted/50 p-2 rounded overflow-auto max-h-60 whitespace-pre-wrap break-all">{staticPreview.diff?.before?.slice(0, 2500) || '—'}</pre>
                  </div>
                  <div>
                    <p className="font-medium mb-1">Yeni &lt;head&gt;</p>
                    <pre className="bg-green-500/5 p-2 rounded overflow-auto max-h-60 whitespace-pre-wrap break-all">{staticPreview.diff?.after?.slice(0, 2500) || '—'}</pre>
                  </div>
                </div>
              </details>
            </div>
          )}

          {writeResult && (
            <div className={`mt-2 text-[11px] rounded p-2 ${writeResult.ok ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
              {writeResult.ok ? '✓' : '✗'} {writeResult.ok
                ? `Dosya yazıldı: ${writeResult.remoteDir}/${writeResult.filename} — uygulanan: ${writeResult.applied?.join(', ')}`
                : (writeResult.error ?? 'Bilinmeyen hata')}
            </div>
          )}
        </div>
      )}

      {snippets && (
        <div className="mt-3 space-y-2">
          {resolvedUrl && <p className="text-[11px] text-muted-foreground">Hedef: <span className="font-mono">{resolvedUrl}</span></p>}
          {snippets.length === 0 && <p className="text-xs text-muted-foreground">Bu sayfa için eksik tag yok ✓</p>}
          {snippets.map((s: any, i: number) => (
            <div key={i} className="rounded-md border">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/30">
                <div>
                  <span className="text-xs font-semibold">{labelFor(s.type)}</span>
                  <span className="text-[11px] text-muted-foreground ml-2">{s.insertLocation}</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => copy(i, s.generatedSnippet)}>
                  {copied === i ? '✓ Kopyalandı' : 'Kopyala'}
                </Button>
              </div>
              <div className="px-3 py-2">
                <p className="text-[11px] text-muted-foreground mb-1.5">{s.reason}</p>
                <pre className="text-[11px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono">{s.generatedSnippet}</pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 2 — Rakipler
// ──────────────────────────────────────────────────────────────────────
type Competitor = { name: string; url: string; strengths?: string[]; weaknesses?: string[] };

function CompetitorsStepBody({
  siteId, initial, onChanged, onboardingMode,
}: {
  siteId: string;
  initial: Competitor[];
  onChanged: () => void;
  onboardingMode?: boolean;
}) {
  const [list, setList] = useState<Competitor[]>(initial ?? []);
  const [draftName, setDraftName] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    setList(initial ?? []);
  }, [initial]);

  const persist = async (next: Competitor[]) => {
    setSaving(true);
    try {
      const saved = await api.setCompetitors(siteId, next);
      setList(saved);
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (url: string) => {
    const next = list.filter((c) => c.url !== url);
    await persist(next);
    toast.success('Rakip kaldırıldı');
  };

  const add = async () => {
    const name = draftName.trim();
    let url = draftUrl.trim();
    if (!name || !url) {
      toast.error('İsim ve URL zorunlu');
      return;
    }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const next = [...list, { name, url }];
    await persist(next);
    setDraftName('');
    setDraftUrl('');
    toast.success('Rakip eklendi');
  };

  const regenerate = async () => {
    if (!confirm('AI yeni bir rakip listesi üretsin mi? Mevcut listenin üzerine yazılır (kaybolur).')) return;
    setRegenerating(true);
    try {
      await api.regenerateBrain(siteId);
      toast.success('Brain yeniden üretiliyor (~60sn) — sayfayı yenile');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRegenerating(false);
    }
  };

  if (onboardingMode && list.length === 0 && !regenerating) {
    return (
      <PipelineProgress
        title="AI rakipleri otomatik tespit ediyor"
        steps={PIPELINE_STEPS.brain}
        running
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Topic engine ve makale üretimi bu listeyi kullanır. AI sana 5-10 rakip önerdi;
        senle yarışan başka siteler varsa ekle, alakasız olanları kaldır.
      </p>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Henüz rakip yok. AI tespit etmediyse aşağıdan elle ekleyebilirsin.
        </div>
      ) : (
        <ul className="divide-y border rounded-lg">
          {list.map((c) => (
            <li key={c.url} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{c.name}</div>
                <a href={c.url} target="_blank" rel="noopener" className="text-xs text-muted-foreground hover:text-brand inline-flex items-center gap-1">
                  {c.url} <ExternalLink className="h-3 w-3" />
                </a>
                {(c.strengths?.length || c.weaknesses?.length) ? (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {c.strengths?.length ? <span>💪 {c.strengths.join(', ')}</span> : null}
                    {c.strengths?.length && c.weaknesses?.length ? ' · ' : null}
                    {c.weaknesses?.length ? <span>🩹 {c.weaknesses.join(', ')}</span> : null}
                  </div>
                ) : null}
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(c.url)} disabled={saving} title="Kaldır">
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border p-3 space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Manuel ekle</div>
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Marka adı" value={draftName} onChange={(e) => setDraftName(e.target.value)} className="flex-1 min-w-[140px]" />
          <Input placeholder="https://rakip.com" value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} className="flex-[2] min-w-[200px]" />
          <Button onClick={add} disabled={saving || !draftName || !draftUrl}>
            <Plus className="h-4 w-4 mr-1" /> Ekle
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating}>
          <Sparkles className="h-4 w-4 mr-1" />
          {regenerating ? 'Üretiliyor…' : 'AI ile yeniden bul'}
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 3 — GSC bağla
// ──────────────────────────────────────────────────────────────────────
function GscStepBody({ site, onChanged }: { site: any; onChanged: () => void }) {
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [properties, setProperties] = useState<Array<{ siteUrl: string; permissionLevel: string | null }> | null>(null);
  const [loadingProps, setLoadingProps] = useState(false);
  const [savingProp, setSavingProp] = useState(false);

  useEffect(() => {
    if (search.get('gsc') === 'connected') {
      toast.success('Google Search Console bağlandı ✓ — şimdi doğru property\'yi seç');
      const url = new URL(window.location.href);
      url.searchParams.delete('gsc');
      window.history.replaceState({}, '', url.toString());
      onChanged();
    }
  }, [search, onChanged]);

  const loadProperties = async () => {
    setLoadingProps(true);
    try {
      const list = await api.listGscProperties(site.id);
      setProperties(list);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoadingProps(false);
    }
  };

  useEffect(() => {
    if (site.gscConnectedAt && properties === null) {
      loadProperties();
    }
  }, [site.gscConnectedAt]);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await api.getGscAuthUrl(site.id);
      window.location.href = url;
    } catch (err: any) {
      toast.error(err.message);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('GSC bağlantısını kesmek istediğine emin misin?')) return;
    setBusy(true);
    try {
      await api.disconnectGsc(site.id);
      toast.success('GSC bağlantısı kesildi');
      setProperties(null);
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const selectProperty = async (propertyUrl: string) => {
    if (propertyUrl === site.gscPropertyUrl) return;
    setSavingProp(true);
    try {
      await api.setGscProperty(site.id, propertyUrl);
      toast.success('Property güncellendi');
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingProp(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        <strong>Opsiyonel.</strong> Bağlamak zorunda değilsin — pipeline GSC olmadan da çalışır.
        Bağlarsan topic engine "gerçek arama verisi" katmanını da kullanır ve Performans sekmesi açılır.
      </p>
      {site.gscConnectedAt ? (
        <div className="space-y-3">
          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Aktif property
            </div>
            {loadingProps ? (
              <Skeleton className="h-9 w-full" />
            ) : properties && properties.length > 0 ? (
              <select
                value={site.gscPropertyUrl ?? ''}
                onChange={(e) => selectProperty(e.target.value)}
                disabled={savingProp}
                className="w-full bg-card border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                {!site.gscPropertyUrl && <option value="">— Property seç —</option>}
                {properties.map((p) => (
                  <option key={p.siteUrl} value={p.siteUrl}>
                    {p.siteUrl}{p.permissionLevel ? ` · ${p.permissionLevel}` : ''}
                  </option>
                ))}
              </select>
            ) : properties && properties.length === 0 ? (
              <p className="text-xs text-red-500">
                Bu Google hesabı GSC'de hiçbir property'e erişim sahibi değil.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Property listesi yükleniyor…</p>
            )}
            <div className="text-xs text-muted-foreground">
              Bağlandı: {new Date(site.gscConnectedAt).toLocaleString('tr-TR')}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={loadProperties} disabled={loadingProps || savingProp}>
              Listeyi Yenile
            </Button>
            <Button size="sm" variant="outline" onClick={disconnect} disabled={busy}>
              <Unlink className="h-4 w-4 mr-1" /> Bağlantıyı Kes
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <div className="font-medium">Henüz bağlı değil</div>
            <div className="text-xs text-muted-foreground mt-0.5">Sonra da bağlayabilirsin.</div>
          </div>
          <Button onClick={connect} disabled={busy}>
            <Link2 className="h-4 w-4 mr-1" /> Google ile Bağla
          </Button>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 4 — GA4 bağla
// ──────────────────────────────────────────────────────────────────────
function Ga4StepBody({ site, onChanged }: { site: any; onChanged: () => void }) {
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [properties, setProperties] = useState<Array<{ propertyId: string; displayName: string; accountName: string }> | null>(null);
  const [loadingProps, setLoadingProps] = useState(false);
  const [savingProp, setSavingProp] = useState(false);

  useEffect(() => {
    if (search.get('ga') === 'connected') {
      toast.success('Google Analytics bağlandı ✓ — şimdi doğru property\'yi seç');
      const url = new URL(window.location.href);
      url.searchParams.delete('ga');
      window.history.replaceState({}, '', url.toString());
      onChanged();
    }
  }, [search, onChanged]);

  const loadProperties = async () => {
    setLoadingProps(true);
    try {
      const list = await api.listGaProperties(site.id);
      setProperties(list);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoadingProps(false);
    }
  };

  useEffect(() => {
    if (site.gaConnectedAt && properties === null) {
      loadProperties();
    }
  }, [site.gaConnectedAt]);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await api.getGaAuthUrl(site.id);
      window.location.href = url;
    } catch (err: any) {
      toast.error(err.message);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('GA4 bağlantısını kesmek istediğine emin misin?')) return;
    setBusy(true);
    try {
      await api.disconnectGa(site.id);
      toast.success('GA4 bağlantısı kesildi');
      setProperties(null);
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const selectProperty = async (propertyId: string) => {
    if (propertyId === site.gaPropertyId) return;
    setSavingProp(true);
    try {
      await api.setGaProperty(site.id, propertyId);
      toast.success('Property güncellendi');
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingProp(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        <strong>Opsiyonel.</strong> Bağlarsan: bounce rate, oturum süresi, conversion verisi
        topic ranker'a sinyal olarak girer ve Performans sekmesinde davranış metrikleri görünür.
      </p>
      {site.gaConnectedAt ? (
        <div className="space-y-3">
          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Aktif property
            </div>
            {loadingProps ? (
              <Skeleton className="h-9 w-full" />
            ) : properties && properties.length > 0 ? (
              <select
                value={site.gaPropertyId ?? ''}
                onChange={(e) => selectProperty(e.target.value)}
                disabled={savingProp}
                className="w-full bg-card border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                {!site.gaPropertyId && <option value="">— Property seç —</option>}
                {properties.map((p) => (
                  <option key={p.propertyId} value={p.propertyId}>
                    {p.displayName} · {p.accountName} ({p.propertyId})
                  </option>
                ))}
              </select>
            ) : properties && properties.length === 0 ? (
              <p className="text-xs text-red-500">
                Bu Google hesabı GA4'te hiçbir property'e erişim sahibi değil.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Property listesi yükleniyor…</p>
            )}
            <div className="text-xs text-muted-foreground">
              Bağlandı: {new Date(site.gaConnectedAt).toLocaleString('tr-TR')}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={loadProperties} disabled={loadingProps || savingProp}>
              Listeyi Yenile
            </Button>
            <Button size="sm" variant="outline" onClick={disconnect} disabled={busy}>
              <Unlink className="h-4 w-4 mr-1" /> Bağlantıyı Kes
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <div className="font-medium">Henüz bağlı değil</div>
            <div className="text-xs text-muted-foreground mt-0.5">Sonra da bağlayabilirsin.</div>
          </div>
          <Button onClick={connect} disabled={busy}>
            <Activity className="h-4 w-4 mr-1" /> Google ile Bağla
          </Button>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 5 — Önerilen Makaleler
// ──────────────────────────────────────────────────────────────────────
function TopicsStepBody({
  queue, articles = [], siteId, onRefresh, onboardingMode,
}: {
  queue: any;
  articles?: any[];
  siteId: string;
  onRefresh: () => void;
  onboardingMode?: boolean;
}) {
  // Bir konu Article olarak yaratildiysa (SCHEDULED/GENERATING/PUBLISHED vs.) onerilenden cikar.
  // Boylece kullanici "bunu surukledim, kullandim" hissini kaybetmesin.
  const usedTopics = new Set(
    (articles ?? [])
      .map((a) => String(a?.topic ?? a?.title ?? '').trim().toLowerCase())
      .filter(Boolean),
  );

  const [running, setRunning] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      await api.runTopicEngineNow(siteId);
      toast.success('Topic engine bitti');
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const generate = async (topic: string) => {
    setGenerating(topic);
    try {
      await api.generateArticle(siteId, topic);
      toast.success('Makale hazırlanıyor — "Makaleler" adımında takip edebilirsin.');
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGenerating(null);
    }
  };

  if (!queue) {
    if (onboardingMode || running) {
      return (
        <PipelineProgress
          title="Topic Engine otomatik calisiyor"
          steps={PIPELINE_STEPS.topicEngine}
          running
        />
      );
    }
    return (
      <div className="space-y-3">
        <div className="text-center py-6">
          <p className="text-sm text-muted-foreground mb-3">Topic queue henüz oluşmadı.</p>
          <Button onClick={run}>Topic Engine Çalıştır</Button>
          <p className="text-xs text-muted-foreground mt-3">~60 sn — Plan + GSC + GEO + Rakip + AI ranker</p>
        </div>
      </div>
    );
  }

  const tier1All = queue.tier1Topics ?? [];
  const tier1 = tier1All.filter((t: any) => {
    const k = String(t?.topic ?? t?.title ?? t?.slug ?? '').trim().toLowerCase();
    return k && !usedTopics.has(k);
  });

  return (
    <div className="space-y-3">
      {(running || generating) && (
        <PipelineProgress
          title={generating ? `Makale üretiliyor: "${generating.slice(0, 60)}…"` : 'Topic Engine yenileniyor'}
          steps={generating ? PIPELINE_STEPS.article : PIPELINE_STEPS.topicEngine}
          running={!!(running || generating)}
        />
      )}

      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">🥇 Tier 1 — En önemli {tier1.length} konu</h4>
        <Button size="sm" variant="outline" onClick={run} disabled={running || !!generating}>
          {running ? 'Yenileniyor…' : 'Yenile'}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground -mt-1">
        💡 Konuyu sürükleyip <strong>İçerik Takvimi</strong>'ne bırakarak otomatik yayın saati belirleyebilirsin.
      </p>

      <div className="grid gap-3">
        {tier1.map((t: any, i: number) => {
          const isThis = generating === t.topic;
          const onDragStart = (e: React.DragEvent) => {
            e.dataTransfer.setData('application/x-luviai-topic', JSON.stringify({
              topic: t.topic,
              slug: t.slug,
              pillar: t.pillar,
              score: t.score,
            }));
            e.dataTransfer.effectAllowed = 'copyMove';
          };
          return (
            <div
              key={i}
              draggable
              onDragStart={onDragStart}
              className={`rounded-lg border p-3 cursor-grab active:cursor-grabbing transition-colors ${isThis ? 'ring-2 ring-brand' : 'hover:border-brand/40'}`}
            >
              <div className="flex justify-between items-start gap-2 mb-1.5 flex-wrap">
                <Badge>SKOR {t.score}</Badge>
                <span className="text-xs text-muted-foreground">{t.persona}</span>
              </div>
              <h5 className="font-semibold text-sm mb-1">{t.topic}</h5>
              <p className="text-xs text-muted-foreground mb-3">{t.data_summary}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" onClick={() => generate(t.topic)} disabled={!!generating}>
                  {isThis ? 'Üretiliyor…' : 'Hemen üret →'}
                </Button>
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  ⇡ veya takvime sürükle
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 6 — Makaleler
// ──────────────────────────────────────────────────────────────────────
const ARTICLE_STATUS_VARIANT: Record<string, any> = {
  DRAFT: 'secondary',
  SCHEDULED: 'outline',
  GENERATING: 'warning',
  EDITING: 'warning',
  REVIZE_NEEDED: 'destructive',
  READY_TO_PUBLISH: 'default',
  PUBLISHED: 'success',
  FAILED: 'destructive',
  ARCHIVED: 'outline',
};

const ARTICLE_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Taslak',
  SCHEDULED: 'Takvimde',
  GENERATING: 'Hazırlanıyor',
  EDITING: 'Editör',
  REVIZE_NEEDED: 'Revize gerekli',
  READY_TO_PUBLISH: 'Yayına hazır',
  PUBLISHED: 'Yayında',
  FAILED: 'Başarısız',
  ARCHIVED: 'Arşiv',
};

function ArticlesStepBody({
  articles, siteId, onRefresh,
}: {
  articles: any[];
  siteId: string;
  onRefresh?: () => void;
}) {
  // Hazirlanan makaleler varsa 8 sn'de bir auto-refresh
  useEffect(() => {
    if (!onRefresh) return;
    const hasGenerating = articles.some((a) => a.status === 'GENERATING' || a.status === 'EDITING');
    if (!hasGenerating) return;
    const t = setInterval(() => onRefresh(), 8000);
    return () => clearInterval(t);
  }, [articles, onRefresh]);

  // Aktif sosyal kanallar — her makalenin altında "X'te paylaş / LinkedIn'de paylaş"
  // toggle rozetleri için.
  const [socialChannels, setSocialChannels] = useState<any[]>([]);
  const [articlePrePlan, setArticlePrePlan] = useState<Record<string, Set<string> | null>>({});

  useEffect(() => {
    let cancelled = false;
    api.listSocialChannels(siteId)
      .then((rows) => { if (!cancelled) setSocialChannels(Array.isArray(rows) ? rows.filter((c: any) => c?.isActive) : []); })
      .catch(() => { if (!cancelled) setSocialChannels([]); });
    return () => { cancelled = true; };
  }, [siteId]);

  useEffect(() => {
    setArticlePrePlan((prev) => {
      const next = { ...prev };
      for (const a of articles) {
        if (next[a.id] !== undefined) continue;
        const raw = (a as any).socialPrePlanChannelIds;
        next[a.id] = Array.isArray(raw) ? new Set<string>(raw as string[]) : null;
      }
      return next;
    });
  }, [articles]);

  const isChannelOn = (articleId: string, channelId: string): boolean => {
    const cur = articlePrePlan[articleId];
    if (cur === undefined || cur === null) return true;
    return cur.has(channelId);
  };

  const toggleChannel = async (articleId: string, channelId: string, articleTitle?: string) => {
    const allActive = socialChannels.map((c) => c.id);
    const cur = articlePrePlan[articleId];
    const set = cur ? new Set(cur) : new Set<string>(allActive);
    if (set.has(channelId)) set.delete(channelId);
    else set.add(channelId);

    setArticlePrePlan((prev) => ({ ...prev, [articleId]: set }));

    const arr = Array.from(set);
    const isAll = arr.length === allActive.length && allActive.every((id) => arr.includes(id));
    try {
      await api.setArticleSocialPrePlan(siteId, articleId, isAll ? null : arr);
      const ch = socialChannels.find((c) => c.id === channelId);
      const channelName = (ch?.type ?? 'kanal').toUpperCase();
      const tShort = (articleTitle ?? '').slice(0, 40) + ((articleTitle ?? '').length > 40 ? '…' : '');
      const titlePart = tShort ? `"${tShort}" → ` : '';
      toast.success(set.has(channelId)
        ? `${titlePart}${channelName}'da paylaşılacak`
        : `${titlePart}${channelName}'dan kaldırıldı`);
    } catch (err: any) {
      toast.error(err.message || 'Kanal tercihi kaydedilemedi');
    }
  };



  // SCHEDULED makaleleri ust ust ay
  const scheduled = articles
    .filter((a) => a?.status === 'SCHEDULED' && a?.scheduledAt)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const otherArticles = articles.filter((a) => a?.status !== 'SCHEDULED');

  return (
    <div className="space-y-4">
      <ContentCalendarPanel
        siteId={siteId}
        scheduled={scheduled}
        otherArticlesCount={otherArticles.length}
        onChanged={onRefresh ?? (() => {})}
        socialChannels={socialChannels}
        isChannelEnabledForArticle={(articleId, channelId) => isChannelOn(articleId, channelId)}
        toggleChannelForArticle={(articleId, channelId, articleTitle) => toggleChannel(articleId, channelId, articleTitle)}
      />

      {otherArticles.length > 0 && (
        <div className="space-y-3">
          {scheduled.length > 0 && (
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
              Üretilen Makaleler ({otherArticles.length})
            </p>
          )}
          {otherArticles.map((a) => {
        const isGenerating = a.status === 'GENERATING' || a.status === 'EDITING';
        const card = (
          <div
            className={`rounded-lg border p-3 transition-all ${
              isGenerating
                ? 'border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/10'
                : 'hover:border-brand/40 hover:shadow-sm'
            }`}
          >
            <div className="flex justify-between items-start gap-2 mb-1.5 flex-wrap">
              <h5 className="font-semibold text-sm flex-1 min-w-0 flex items-center gap-2">
                {isGenerating && (
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                )}
                {a.title}
              </h5>
              <Badge variant={ARTICLE_STATUS_VARIANT[a.status] ?? 'secondary'}>
                {ARTICLE_STATUS_LABEL[a.status] ?? a.status}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground flex gap-3 flex-wrap items-center">
              {isGenerating ? (
                <span className="text-amber-700 dark:text-amber-400">
                  6 ajan zinciri çalışıyor (~2-4 dk)
                </span>
              ) : (
                <>
                  {a.wordCount && <span>{a.wordCount} kelime</span>}
                  {a.readingTime && <span>{a.readingTime} dk</span>}
                  {a.editorScore != null && <span>Editör: {a.editorScore}/60</span>}
                </>
              )}
              {!isGenerating && (
                <span className="ml-auto text-brand font-medium inline-flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Aç →
                </span>
              )}
            </div>
            {!isGenerating && socialChannels.length > 0 && (
              <div
                className="mt-2 pt-2 border-t border-border/40"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              >
                <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1.5">
                  <span className="text-[11px] font-medium text-foreground/80">
                    Bu makale için paylaşım kanalları
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">
                    {a.status === 'PUBLISHED' ? 'Yayında — sonraki güncellemede uygulanır' : 'Yayınlanınca seçili kanallarda paylaşılır'}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {socialChannels.map((ch: any) => {
                    const on = isChannelOn(a.id, ch.id);
                    const meta = getChannelMeta(ch.type ?? '');
                    const Icon = meta.Icon;
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleChannel(a.id, ch.id, a.title || a.topic);
                        }}
                        title={`${meta.shortName}: ${on ? 'paylaşımdan kaldır' : 'paylaşıma ekle'}`}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-all ${
                          on
                            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20'
                            : 'bg-muted border-muted-foreground/20 text-muted-foreground/60 hover:bg-muted/80 line-through'
                        }`}
                      >
                        <Icon className={`h-3 w-3 ${on ? meta.brandClass : ''}`} />
                        {on ? meta.shareLabel : `${meta.shortName} kapalı`}
                      </button>
                    );
                  })}
                  {(() => {
                    const cur = articlePrePlan[a.id];
                    const onCount = (cur === null || cur === undefined)
                      ? socialChannels.length
                      : socialChannels.filter((c: any) => cur.has(c.id)).length;
                    if (onCount === 0) {
                      return (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-auto">
                          Hiçbir kanalda paylaşılmayacak
                        </span>
                      );
                    }
                    if (onCount === socialChannels.length) {
                      return (
                        <span className="text-[10px] text-muted-foreground/70 ml-auto">
                          Tüm kanallarda paylaşılacak
                        </span>
                      );
                    }
                    return (
                      <span className="text-[10px] text-muted-foreground/70 ml-auto">
                        Sadece {onCount}/{socialChannels.length} kanalda
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        );
        return isGenerating ? (
          <div key={a.id}>{card}</div>
        ) : (
          <Link key={a.id} href={`/sites/${siteId}/articles/${a.id}` as any} className="block">
            {card}
          </Link>
        );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// İçerik Takvimi — drag-drop'lu haftalik grid
// Drop edilebilir source'lar:
//   - 'application/x-luviai-topic'   → tier-1 kart (yeni article schedule)
//   - 'application/x-luviai-article' → mevcut SCHEDULED article (reschedule)
// ──────────────────────────────────────────────────────────────────────
export function ContentCalendarPanel({
  siteId,
  scheduled,
  otherArticlesCount,
  onChanged,
  socialChannels = [],
  isChannelEnabledForArticle,
  toggleChannelForArticle,
}: {
  siteId: string;
  scheduled: any[];
  otherArticlesCount: number;
  onChanged: () => void;
  // Per-article social pre-plan — parent'tan gelir, ortak state.
  // socialChannels listesi yoksa rozetler yerine "Sosyal Kanal ekle" linki.
  socialChannels?: any[];
  isChannelEnabledForArticle?: (articleId: string, channelId: string) => boolean;
  toggleChannelForArticle?: (articleId: string, channelId: string, articleTitle?: string) => void;
}) {
  const [monthOffset, setMonthOffset] = useState(0); // 0 = bu ay
  const [pendingDrop, setPendingDrop] = useState<{ date: Date; data: any; kind: 'topic' | 'article' } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Ay matrisini hesapla — Google Calendar gibi 6 satır x 7 sütun (42 hücre).
  // Pazartesi haftanın ilk günü.
  const today = new Date();
  const focusYear = today.getFullYear();
  const focusMonth = today.getMonth() + monthOffset;
  const firstOfMonth = new Date(focusYear, focusMonth, 1);
  const firstWeekday = firstOfMonth.getDay() === 0 ? 7 : firstOfMonth.getDay(); // Mon=1..Sun=7
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - (firstWeekday - 1));
  gridStart.setHours(0, 0, 0, 0);

  const days = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cts', 'Paz'];
  const monthDates: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    monthDates.push(d);
  }
  const monthLabel = firstOfMonth.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });

  const fmtDate = (d: Date) => `${d.getDate()}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const articlesByDay = (dayDate: Date) => {
    return scheduled.filter((a) => {
      const ad = new Date(a.scheduledAt);
      return ad.getFullYear() === dayDate.getFullYear() &&
        ad.getMonth() === dayDate.getMonth() &&
        ad.getDate() === dayDate.getDate();
    }).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  };

  const onDayDrop = (e: React.DragEvent, dayDate: Date) => {
    e.preventDefault();
    const topicJson = e.dataTransfer.getData('application/x-luviai-topic');
    const articleJson = e.dataTransfer.getData('application/x-luviai-article');
    if (topicJson) {
      const data = JSON.parse(topicJson);
      setPendingDrop({ date: dayDate, data, kind: 'topic' });
    } else if (articleJson) {
      const data = JSON.parse(articleJson);
      setPendingDrop({ date: dayDate, data, kind: 'article' });
    }
  };

  const confirmDrop = async (hour: number, minute: number) => {
    if (!pendingDrop) return;
    setSubmitting(true);
    const target = new Date(pendingDrop.date);
    target.setHours(hour, minute, 0, 0);

    try {
      if (pendingDrop.kind === 'topic') {
        await api.scheduleTopicToCalendar(siteId, {
          topic: pendingDrop.data.topic,
          slug: pendingDrop.data.slug,
          pillar: pendingDrop.data.pillar,
          scheduledAt: target.toISOString(),
        });
        toast.success(`Konu takvime eklendi: ${target.toLocaleString('tr-TR')}`);
      } else {
        await api.rescheduleArticle(siteId, pendingDrop.data.id, target.toISOString());
        toast.success(`Makale yeni saate taşındı: ${target.toLocaleString('tr-TR')}`);
      }
      setPendingDrop(null);
      onChanged();
    } catch (err: any) {
      toast.error(err.message || 'Takvime eklenemedi');
    } finally {
      setSubmitting(false);
    }
  };

  const removeArticle = async (articleId: string) => {
    try {
      await api.unscheduleArticle(siteId, articleId);
      toast.success('Takvimden kaldırıldı');
      onChanged();
    } catch (err: any) {
      toast.error(err.message || 'Kaldırılamadı');
    }
  };

  return (
    <div className="rounded-lg border border-brand/30 bg-gradient-to-br from-brand/5 to-transparent p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div>
          <p className="text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-brand" />
            İçerik Takvimi
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {scheduled.length} makale planlandı · sürükle-bırak ile gün/saat ayarla
          </p>
        </div>
        <div className="flex items-center gap-2">
          {otherArticlesCount === 0 && (
            <span className="text-[11px] uppercase tracking-wide bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 rounded px-2 py-1 font-semibold">
              TRIAL · 1.makale ücretsiz
            </span>
          )}
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setMonthOffset(0)}>Bugün</Button>
          <div className="inline-flex items-center gap-1 border rounded-md">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setMonthOffset(monthOffset - 1)}>‹</Button>
            <span className="text-[11px] font-medium px-2 min-w-[120px] text-center capitalize">
              {monthLabel}
            </span>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setMonthOffset(monthOffset + 1)}>›</Button>
          </div>
        </div>
      </div>

      {/* Hafta günü başlıkları */}
      <div className="grid grid-cols-7 gap-1.5 mb-1">
        {days.map((d) => (
          <div key={d} className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide text-center py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {monthDates.map((dayDate, i) => {
          const dayArticles = articlesByDay(dayDate);
          const isToday =
            dayDate.toDateString() === new Date().toDateString();
          const isPast = dayDate.getTime() < new Date().setHours(0, 0, 0, 0);
          const inFocusMonth = dayDate.getMonth() === firstOfMonth.getMonth();
          return (
            <div
              key={i}
              onDragOver={(e) => {
                e.preventDefault();
                const types = e.dataTransfer.types;
                e.dataTransfer.dropEffect = types.includes('application/x-luviai-topic') ? 'copy' : 'move';
              }}
              onDrop={(e) => onDayDrop(e, dayDate)}
              className={`rounded-md border p-1.5 min-h-[88px] flex flex-col gap-1 transition-colors ${
                isToday
                  ? 'border-brand/50 bg-brand/5'
                  : !inFocusMonth
                  ? 'bg-muted/10 opacity-50'
                  : isPast
                  ? 'bg-muted/20 opacity-70'
                  : 'bg-card hover:border-brand/30 hover:bg-brand/5'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-bold tracking-wide">
                <span className={isToday ? 'text-brand' : inFocusMonth ? 'text-foreground/70' : 'text-muted-foreground/40'}>
                  {dayDate.getDate()}
                </span>
                {dayArticles.length > 0 && (
                  <span className="text-[9px] text-brand/70 font-normal">{dayArticles.length}</span>
                )}
              </div>
              {dayArticles.map((a, idx) => {
                const isFirst = idx === 0 && i === 0 && monthOffset === 0;
                const locked = otherArticlesCount === 0 && !isFirst;
                const onDragStart = (e: React.DragEvent) => {
                  e.dataTransfer.setData('application/x-luviai-article', JSON.stringify({
                    id: a.id, topic: a.topic, title: a.title,
                  }));
                  // copyMove → cell dropEffect 'copy' veya 'move' kabul eder (browser reddetmesin)
                  e.dataTransfer.effectAllowed = 'copyMove';
                };
                return (
                  <div
                    key={a.id}
                    draggable
                    onDragStart={onDragStart}
                    className={`group rounded text-[10px] p-1 leading-tight cursor-grab active:cursor-grabbing border ${
                      locked ? 'bg-muted/40 border-muted opacity-70' : 'bg-brand/10 border-brand/30 hover:bg-brand/15'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono font-bold text-brand">{fmtTime(a.scheduledAt)}</span>
                      <button
                        type="button"
                        draggable={false}
                        onClick={(e) => { e.stopPropagation(); removeArticle(a.id); }}
                        className="opacity-0 group-hover:opacity-100 text-red-500 text-[10px]"
                        title="Takvimden kaldir"
                      >
                        ✕
                      </button>
                    </div>
                    <p className="font-medium truncate mt-0.5">{a.title || a.topic}</p>
                    <p className="text-[9px] text-muted-foreground">{locked ? '🔒 paket' : '📅 planlı'}</p>
                    {socialChannels.length > 0 ? (
                      <div
                        className="flex flex-wrap gap-0.5 mt-1"
                        onClick={(e) => e.stopPropagation()}
                        draggable={false}
                      >
                        {socialChannels.map((ch: any) => {
                          const on = isChannelEnabledForArticle ? isChannelEnabledForArticle(a.id, ch.id) : true;
                          const meta = getChannelMeta(ch.type ?? '');
                          const Icon = meta.Icon;
                          return (
                            <button
                              key={ch.id}
                              type="button"
                              draggable={false}
                              onClick={(e) => { e.stopPropagation(); toggleChannelForArticle?.(a.id, ch.id, a.title || a.topic); }}
                              title={`${meta.shortName}: ${on ? 'paylaşımdan kaldır' : 'paylaşıma ekle'}`}
                              className={`inline-flex items-center justify-center h-5 w-5 rounded border transition-colors ${
                                on
                                  ? `bg-emerald-500/15 border-emerald-500/40 ${meta.brandClass} hover:bg-emerald-500/25`
                                  : 'bg-muted border-muted-foreground/20 text-muted-foreground/40 hover:bg-muted/80 opacity-60'
                              }`}
                              aria-label={meta.shortName}
                            >
                              <Icon className="h-3 w-3" />
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <Link
                        href={`/sites/${siteId}?tab=settings#social-channels` as any}
                        draggable={false}
                        onClick={(e) => e.stopPropagation()}
                        className="block mt-1 text-[9px] text-amber-600 dark:text-amber-400 hover:underline font-medium"
                      >
                        + Sosyal medya paylaşımına aç
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {pendingDrop && (
        <TimePickerDialog
          date={pendingDrop.date}
          topicTitle={pendingDrop.data.topic || pendingDrop.data.title}
          submitting={submitting}
          onCancel={() => setPendingDrop(null)}
          onConfirm={(h, m) => confirmDrop(h, m)}
        />
      )}
    </div>
  );
}

function TimePickerDialog({
  date, topicTitle, submitting, onCancel, onConfirm,
}: {
  date: Date;
  topicTitle: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (hour: number, minute: number) => void;
}) {
  const [time, setTime] = useState('10:00');
  const submit = () => {
    const [h, m] = time.split(':').map((x) => parseInt(x, 10));
    onConfirm(h, m);
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-background border rounded-lg shadow-xl p-5 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold mb-1">Yayın saati seç</p>
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{topicTitle}</p>
        <p className="text-xs text-muted-foreground mb-3">
          📅 {date.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          autoFocus
        />
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={submitting}>İptal</Button>
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? 'Ekleniyor…' : 'Takvime ekle'}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">
          ⏰ Bu saatten 15 dk önce makale üretimi başlar, tam saatte yayınlanır.
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Diğer (Performans + Ayarlar — sayfa sonuna gelir)
// ──────────────────────────────────────────────────────────────────────
function DigerSection({ siteId }: { siteId: string }) {
  return (
    <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Link href={`/sites/${siteId}?tab=analytics` as any} className="block">
        <Card className="hover:border-brand/40 transition-colors">
          <CardContent className="p-4 flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-brand" />
            <div>
              <div className="font-semibold text-sm">Performans</div>
              <div className="text-xs text-muted-foreground">GSC + GA verisi, trending sorgular</div>
            </div>
          </CardContent>
        </Card>
      </Link>
      <Link href={`/sites/${siteId}?tab=settings` as any} className="block">
        <Card className="hover:border-brand/40 transition-colors">
          <CardContent className="p-4 flex items-center gap-3">
            <Send className="h-5 w-5 text-brand" />
            <div>
              <div className="font-semibold text-sm">Yayın Hedefleri</div>
              <div className="text-xs text-muted-foreground">WordPress, FTP, GitHub vb.</div>
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// DragDropTutorialModal — ilk makale bittikten sonra bir kez gosterilir.
// Kullaniciya "Onerilen Makaleler" karti surukleyip Icerik Takvimi'ne nasil
// birakacagini animasyonla gosterir.
// ──────────────────────────────────────────────────────────────────────
function DragDropTutorialModal({
  open, onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <style>{`
        @keyframes luviai-drag-step {
          0%   { transform: translate(0, 0) scale(1);    opacity: 1; }
          25%  { transform: translate(20px, -4px) scale(1.04); opacity: 1; }
          55%  { transform: translate(180px, 110px) scale(1.04); opacity: 1; }
          70%  { transform: translate(180px, 110px) scale(0.9);  opacity: 0.6; }
          85%  { transform: translate(180px, 110px) scale(0.9);  opacity: 0; }
          100% { transform: translate(0, 0) scale(1);    opacity: 1; }
        }
        @keyframes luviai-target-pulse {
          0%, 60%   { background-color: transparent; }
          55%, 70% { background-color: rgba(124, 92, 252, 0.18); }
          100%      { background-color: transparent; }
        }
        @keyframes luviai-time-show {
          0%, 65% { opacity: 0; transform: translateY(4px); }
          80%, 95% { opacity: 1; transform: translateY(0); }
          100%    { opacity: 0; transform: translateY(0); }
        }
        .luviai-drag-card { animation: luviai-drag-step 4.5s ease-in-out infinite; }
        .luviai-drag-target { animation: luviai-target-pulse 4.5s ease-in-out infinite; }
        .luviai-drag-time   { animation: luviai-time-show 4.5s ease-in-out infinite; }
      `}</style>

      <div
        className="w-full max-w-lg rounded-xl border bg-card shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-semibold">İlk makalen hazır! 🎉</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Sıradakiler için sürükle-bırak ile takvim oluşturabilirsin.
              Önerilen makale kartını <strong>İçerik Takvimi</strong>'ne bırak,
              saat aç ve yayın programına ekle.
            </p>
          </div>
        </div>

        {/* Animasyon sahnesi */}
        <div className="relative h-56 rounded-lg border bg-muted/30 overflow-hidden mb-4">
          {/* Sürüklenen örnek kart */}
          <div
            className="luviai-drag-card absolute top-3 left-3 w-44 rounded-md border bg-card shadow-md p-2.5 z-20"
            style={{ willChange: 'transform' }}
          >
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand text-brand-foreground">
                SKOR 92
              </span>
            </div>
            <div className="text-xs font-semibold leading-tight">
              Shared Hosting Nedir?
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              ⇡ veya takvime sürükle
            </div>
          </div>

          {/* Takvim grid */}
          <div className="absolute inset-x-3 bottom-3 grid grid-cols-3 gap-2 z-10">
            {['Pzt', 'Sal', 'Çar'].map((d, i) => (
              <div
                key={d}
                className={`h-20 rounded border border-dashed border-border/60 p-1.5 text-[10px] text-muted-foreground ${i === 1 ? 'luviai-drag-target' : ''}`}
              >
                <div className="font-semibold mb-0.5">{d}</div>
                {i === 1 && (
                  <div className="luviai-drag-time mt-2 inline-block px-1.5 py-0.5 rounded bg-brand/15 text-brand font-medium text-[10px]">
                    10:00 ✓
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <ul className="text-sm space-y-1.5 mb-4">
          <li className="flex gap-2"><span className="text-brand font-bold">1.</span> Önerilen kartı tut, sürükle.</li>
          <li className="flex gap-2"><span className="text-brand font-bold">2.</span> Takvimde istediğin güne bırak.</li>
          <li className="flex gap-2"><span className="text-brand font-bold">3.</span> Saat seç → otomatik yayın programına eklenir.</li>
        </ul>

        <div className="flex justify-end">
          <Button onClick={onClose}>Anladım</Button>
        </div>
      </div>
    </div>
  );
}

