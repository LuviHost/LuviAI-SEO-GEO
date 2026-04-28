'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  CheckCircle2, ChevronDown, Circle, ExternalLink, Plus, Trash2,
  BarChart3, Link2, Unlink, Activity, Sparkles, FileText, Send, Share2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PipelineProgress, PIPELINE_STEPS } from '@/components/pipeline-progress';
import { SocialChannelsStep } from '@/components/social-channels-step';
import { SocialCalendarStep } from '@/components/social-calendar-step';

type StepStatus = 'pending' | 'auto-running' | 'done' | 'skipped';

interface StepDef {
  id: string;
  n: number;
  title: string;
  status: StepStatus;
  hint: string;
  optional?: boolean;
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
    {
      id: 'gsc', n: 3, title: 'Google Search Console',
      status: site.gscConnectedAt ? 'done' : 'skipped',
      hint: site.gscConnectedAt ? 'Bağlı' : 'Atlandı (opsiyonel)',
      optional: true,
    },
    {
      id: 'ga4', n: 4, title: 'Google Analytics',
      status: site.gaConnectedAt ? 'done' : 'skipped',
      hint: site.gaConnectedAt ? 'Bağlı' : 'Atlandı (opsiyonel)',
      optional: true,
    },
    {
      id: 'social', n: 5, title: 'Sosyal Kanallar',
      status: 'skipped', // bu step opsiyonel; gerçek durumu kart kendi içinde gösterir
      hint: 'LinkedIn + X (Twitter)',
      optional: true,
    },
    {
      id: 'social-calendar', n: 6, title: 'Sosyal Takvim',
      status: 'skipped',
      hint: 'Plana göre haftalık otomatik post',
      optional: true,
    },
    {
      id: 'topics', n: 7, title: 'Önerilen Makaleler',
      status: queue ? 'done' : (onboardingMode ? 'auto-running' : 'pending'),
      hint: queue ? `${(queue.tier1Topics ?? []).length} öneri` : 'Topic engine bekleniyor',
    },
    {
      id: 'articles', n: 8, title: 'Makaleler',
      status: articles.length > 0 ? 'done' : 'pending',
      hint: articles.length > 0 ? `${articles.length} makale` : 'İlk makale ücretsiz',
    },
  ];

  const firstIncomplete = steps.find((s) => s.status !== 'done' && !s.optional)?.id ?? 'audit';
  const [open, setOpen] = useState<string>(initialStep && steps.find((s) => s.id === initialStep) ? initialStep : firstIncomplete);
  const [userTouched, setUserTouched] = useState<boolean>(!!initialStep);

  useEffect(() => {
    if (initialStep && steps.find((s) => s.id === initialStep)) {
      setOpen(initialStep);
      setUserTouched(true);
    }
  }, [initialStep]);

  // Auto-advance: kullanici manuel toggle yapmadiysa ve onboarding modundaysa,
  // tamamlanmis adimdan bir sonrakine otomatik gec.
  useEffect(() => {
    if (userTouched) return;
    if (!onboardingMode) return;
    if (open === firstIncomplete) return;
    setOpen(firstIncomplete);
  }, [firstIncomplete, onboardingMode, userTouched, open]);

  const toggle = (id: string) => {
    const next = open === id ? '' : id;
    setOpen(next);
    setUserTouched(true);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('step', next);
    else url.searchParams.delete('step');
    window.history.replaceState({}, '', url.toString());
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
            setOpen(id);
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
          isOpen={open === s.id}
          onToggle={() => toggle(s.id)}
        >
          {s.id === 'audit' && <AuditStepBody audit={audit} siteId={site.id} onRefresh={onRefresh} onboardingMode={onboardingMode} />}
          {s.id === 'competitors' && <CompetitorsStepBody siteId={site.id} initial={site.brain?.competitors ?? []} onChanged={onRefresh} onboardingMode={onboardingMode} />}
          {s.id === 'gsc' && <GscStepBody site={site} onChanged={onRefresh} />}
          {s.id === 'ga4' && <Ga4StepBody site={site} onChanged={onRefresh} />}
          {s.id === 'social' && <SocialChannelsStep siteId={site.id} />}
          {s.id === 'social-calendar' && <SocialCalendarStep siteId={site.id} />}
          {s.id === 'topics' && <TopicsStepBody queue={queue} siteId={site.id} onRefresh={onRefresh} onboardingMode={onboardingMode} />}
          {s.id === 'articles' && <ArticlesStepBody articles={articles} siteId={site.id} />}
        </StepCard>
      ))}

      <DigerSection siteId={site.id} />
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
      {isOpen && (
        <CardContent className="pt-0 px-4 pb-5 border-t border-border/60 mt-1">
          <div className="pt-4">{children}</div>
        </CardContent>
      )}
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
          <div className="text-3xl font-bold text-red-500">{issues.length}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Bulunan Sorun</div>
        </div>
      </div>

      {fixable.length > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm font-semibold">⚡ {fixable.length} sorun otomatik düzeltilebilir</p>
          <Button size="sm" onClick={applyFix} disabled={fixing}>Otomatik Düzelt</Button>
        </div>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer font-medium py-2">Detaylı kontrol listesi (14 nokta)</summary>
        <div className="divide-y border rounded-lg mt-2">
          {Object.entries(checks).filter(([, v]: any) => v?.name).map(([k, v]: any) => (
            <div key={k} className="px-4 py-2 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                {v.valid ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Circle className="h-4 w-4 text-red-500" />}
                {v.name}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{v.score}/100</span>
            </div>
          ))}
        </div>
      </details>

      <div className="flex justify-end pt-2">
        <Button size="sm" variant="outline" onClick={run} disabled={running || fixing}>
          {running ? 'Hesaplanıyor…' : 'Skoru Yenile'}
        </Button>
      </div>
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
  queue, siteId, onRefresh, onboardingMode,
}: {
  queue: any;
  siteId: string;
  onRefresh: () => void;
  onboardingMode?: boolean;
}) {
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
      toast.success('Makale üretildi! "Makaleler" adımında gör.');
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

  const tier1 = queue.tier1Topics ?? [];

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

      <div className="grid gap-3">
        {tier1.map((t: any, i: number) => {
          const isThis = generating === t.topic;
          return (
            <div key={i} className={`rounded-lg border p-3 ${isThis ? 'ring-2 ring-brand' : ''}`}>
              <div className="flex justify-between items-start gap-2 mb-1.5 flex-wrap">
                <Badge>SKOR {t.score}</Badge>
                <span className="text-xs text-muted-foreground">{t.persona}</span>
              </div>
              <h5 className="font-semibold text-sm mb-1">{t.topic}</h5>
              <p className="text-xs text-muted-foreground mb-3">{t.data_summary}</p>
              <Button size="sm" onClick={() => generate(t.topic)} disabled={!!generating}>
                {isThis ? 'Üretiliyor…' : 'Bu konuyu üret →'}
              </Button>
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
  GENERATING: 'warning',
  EDITING: 'warning',
  REVIZE_NEEDED: 'destructive',
  READY_TO_PUBLISH: 'default',
  PUBLISHED: 'success',
  FAILED: 'destructive',
  ARCHIVED: 'outline',
};

function ArticlesStepBody({ articles, siteId }: { articles: any[]; siteId: string }) {
  if (articles.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        Henüz makale üretilmedi. Önceki adımdan bir konu seç.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {articles.map((a) => (
        <Link key={a.id} href={`/sites/${siteId}/articles/${a.id}` as any} className="block">
          <div className="rounded-lg border p-3 hover:border-brand/40 hover:shadow-sm transition-all">
            <div className="flex justify-between items-start gap-2 mb-1.5 flex-wrap">
              <h5 className="font-semibold text-sm flex-1 min-w-0">{a.title}</h5>
              <Badge variant={ARTICLE_STATUS_VARIANT[a.status] ?? 'secondary'}>{a.status}</Badge>
            </div>
            <div className="text-xs text-muted-foreground flex gap-3 flex-wrap items-center">
              {a.wordCount && <span>{a.wordCount} kelime</span>}
              {a.readingTime && <span>{a.readingTime} dk</span>}
              {a.editorScore != null && <span>Editör: {a.editorScore}/60</span>}
              <span className="ml-auto text-brand font-medium inline-flex items-center gap-1">
                <FileText className="h-3 w-3" /> Aç →
              </span>
            </div>
          </div>
        </Link>
      ))}
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
