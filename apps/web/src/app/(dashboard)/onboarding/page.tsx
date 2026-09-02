'use client';

/*
 * QUICK MISSION — Tek sayfa, sıfır soru onboarding.
 *
 * Akış:
 *   Stage A (input)   — kullanıcı sadece site URL'ini girer
 *   Stage B (mission) — backend'in ONBOARDING_CHAIN job'u koşar:
 *                       brain → audit → topics → platform → schedule
 *                       Frontend 4sn'de bir polling yapar; site.status === 'ACTIVE'
 *                       olunca veya brain+audit+queue üçü hazır olunca
 *                       /sites/{id}?tab=flow&onboarding=done sayfasına yönlendirir.
 *
 * Defaultlar (Brain analizi iyileştirir; kullanıcı sonra ayarlardan değiştirebilir):
 *   name      → URL hostname kökü
 *   niche     → 'diğer'   (Brain → real niche)
 *   language  → 'tr'
 *   autopilot → true
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { track } from '@/lib/landing-track';
import { toast } from 'sonner';
import { Rocket, ChevronRight, Globe } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  MissionShell,
  MissionWheel,
  type MissionTask,
} from '@/components/ai-scan';

const POLL_INTERVAL_MS = 2000;          // 4s → 2s, ilk wow için
const ESTIMATED_TOTAL_MS = 60_000;       // 90s → 60s hedef
const RESUME_KEY = 'luviai-quickmission-active-site';
/** signup_complete yalniz bir kez gonderilsin */
const SIGNUP_EVENT_KEY = 'luvi_signup_tracked';

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingInner />
    </Suspense>
  );
}

function OnboardingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();

  // ?siteId=X ile devam edilebilir (kullanıcı sayfayı yenilerse)
  const queryId = params.get('siteId');
  const [resumeId, setResumeId] = useState<string | null>(queryId);
  const [hydratedResume, setHydratedResume] = useState(false);

  useEffect(() => {
    if (resumeId) { setHydratedResume(true); return; }
    try {
      const sid = localStorage.getItem(RESUME_KEY);
      if (sid) setResumeId(sid);
    } catch (_e) { /* noop */ }
    setHydratedResume(true);
  }, []);

  /**
   * Funnel'in SON basamagi. NEDEN burasi: `signup_complete` eventi bugune kadar hicbir yerde
   * uretilmiyordu — /admin/landing'deki "Signup" metrigi ve session→signup orani her zaman 0
   * gorunuyordu (01.09.2026 tespiti). Kullanicinin urune ilk girisi dogru sinyaldir; oturum
   * basina bir kez gonderilir.
   */
  useEffect(() => {
    if (sessionStatus !== 'authenticated') return;
    try {
      if (localStorage.getItem(SIGNUP_EVENT_KEY)) return;
      localStorage.setItem(SIGNUP_EVENT_KEY, String(Date.now()));
      track('signup_complete');
    } catch { /* localStorage kapaliysa olcum atlanir, akis etkilenmez */ }
  }, [sessionStatus]);

  if (!hydratedResume) {
    return (
      <MissionShell>
        <BootingNote />
      </MissionShell>
    );
  }

  if (resumeId) {
    return (
      <MissionShell>
        <MissionStage
          siteId={resumeId}
          onComplete={(id) => {
            try { localStorage.removeItem(RESUME_KEY); } catch (_e) { /* noop */ }
            router.push(`/sites/${id}?tab=flow&onboarding=done`);
          }}
          onAbort={() => {
            try { localStorage.removeItem(RESUME_KEY); } catch (_e) { /* noop */ }
            setResumeId(null);
          }}
        />
      </MissionShell>
    );
  }

  return (
    <MissionShell>
      <InputStage
        sessionUserId={session?.user?.id ?? null}
        sessionStatus={sessionStatus}
        onCreated={(siteId) => {
          try { localStorage.setItem(RESUME_KEY, siteId); } catch (_e) { /* noop */ }
          setResumeId(siteId);
        }}
      />
    </MissionShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Stage A — URL Input
// ──────────────────────────────────────────────────────────────────────
function InputStage({
  sessionUserId,
  sessionStatus,
  onCreated,
}: {
  sessionUserId: string | null;
  sessionStatus: 'authenticated' | 'unauthenticated' | 'loading';
  onCreated: (siteId: string) => void;
}) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  const valid = (() => {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch { return false; }
  })();

  const submit = async () => {
    if (!valid) { toast.error('Geçerli bir URL gir (https:// ile başlamalı)'); return; }
    if (sessionStatus !== 'authenticated' || !sessionUserId) {
      router.push('/signin?callbackUrl=/onboarding');
      return;
    }
    setCreating(true);
    try {
      const guessedName = (() => {
        try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0]; }
        catch { return 'Site'; }
      })();

      // AI ile niş tespit — site oluşturmadan önce paralel başlat.
      // Başarısız olursa 'diğer' fallback, akış kesilmez.
      let detectedNiche = 'diğer';
      try {
        const detection = await Promise.race([
          api.detectNiche(url),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)), // 12sn cap
        ]);
        if (detection && (detection as any).niche) {
          const d = detection as any;
          // Confidence yüksekse customNiche varsa onu, yoksa standardı kullan
          if (d.confidence >= 0.5) {
            detectedNiche = (d.niche === 'diğer' && d.customNiche)
              ? d.customNiche
              : d.niche;
            toast.success(`Niş tespit edildi: ${detectedNiche}`);
          }
        }
      } catch (_e) { /* fallback to 'diğer' */ }

      const created = await api.createSite({
        url,
        name: guessedName,
        niche: detectedNiche,
        language: 'tr',
      } as any);
      toast.success('Görev başlatıldı — AI çalışıyor');
      onCreated(created.id);
    } catch (err: any) {
      toast.error(err.message);
      setCreating(false);
    }
  };

  const launchDemo = async () => {
    if (sessionStatus !== 'authenticated') {
      router.push('/signin?callbackUrl=/onboarding');
      return;
    }
    setDemoLoading(true);
    try {
      const r = await api.createDemoSite();
      toast.success('Demo site hazır');
      router.push(`/sites/${r.siteId}`);
    } catch (err: any) {
      toast.error(err.message);
      setDemoLoading(false);
    }
  };

  return (
    <div className="relative max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
      {/* mission badge */}
      <div className="flex items-center justify-center gap-2 mb-4">
        <Rocket className="h-3.5 w-3.5 text-brand" />
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand font-semibold">
          Mission Console · Yeni Görev
        </span>
      </div>

      {/* hero */}
      <h1 className="text-center text-4xl sm:text-5xl font-bold tracking-tight mb-3">
        Tek tek adımları unut.
      </h1>
      <p className="text-center text-base sm:text-lg text-muted-foreground mb-8 max-w-lg mx-auto">
        Sadece site URL'ini gir. AI; markanı, rakiplerini, hedef kitleni tespit edip
        SEO + GEO skorunu hesaplar ve içerik takvimini hazırlar — ortalama <span className="font-semibold text-foreground">60–90 sn</span>.
      </p>

      {/* input panel */}
      <div className="relative rounded-2xl border-2 border-brand/30 bg-card/70 backdrop-blur-sm p-1 shadow-[0_0_0_1px_rgb(124_58_237/0.05),0_20px_60px_-20px_rgb(124_58_237/0.3)]">
        <div className="relative flex items-center gap-2 p-1">
          <Globe className="h-5 w-5 text-brand/70 ml-3 shrink-0" />
          <Input
            type="url"
            placeholder="https://siteniz.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && valid && !creating) submit(); }}
            autoFocus
            className="border-0 bg-transparent text-lg font-mono h-14 focus-visible:ring-0 focus-visible:ring-offset-0 px-2"
          />
          <Button
            onClick={submit}
            disabled={!valid || creating}
            className={cn(
              'h-12 px-6 mr-1 font-mono text-xs uppercase tracking-[0.18em] group relative overflow-hidden shrink-0',
              'bg-gradient-to-r from-brand to-brand/85 hover:from-brand hover:to-brand',
              'shadow-[0_0_0_1px_rgb(124_58_237/0.4),0_8px_28px_-6px_rgb(124_58_237/0.5)]',
              'hover:shadow-[0_0_0_1px_rgb(124_58_237/0.6),0_12px_40px_-6px_rgb(124_58_237/0.7)]',
              'disabled:shadow-none transition-all duration-300',
            )}
          >
            <span className="relative z-10 flex items-center gap-1.5">
              {creating ? 'Başlatılıyor…' : 'Görevi Başlat'}
              {!creating && <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />}
            </span>
            <span className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12 group-hover:translate-x-[400%] transition-transform duration-700" />
          </Button>
        </div>
      </div>

      {/* mini features */}
      <ul className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
        {[
          { title: 'Otomatik AI Brain', sub: 'Marka sesi, persona, rakip analizi' },
          { title: 'Audit + GEO skor', sub: '14 SEO kontrolü + AI alıntı analizi' },
          { title: 'Hazır içerik takvimi', sub: 'AI tier-1 başlıkları otomatik planlar' },
        ].map((f) => (
          <li
            key={f.title}
            className="rounded-xl border border-brand/15 bg-card/40 backdrop-blur-sm p-3"
          >
            <p className="text-xs font-semibold">{f.title}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{f.sub}</p>
          </li>
        ))}
      </ul>

      {/* demo CTA */}
      <div className="mt-8 flex items-center justify-center gap-3 text-sm">
        <span className="text-muted-foreground font-mono text-xs">veya</span>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={launchDemo}
          disabled={demoLoading}
          className="border-brand/30 hover:border-brand/60 hover:bg-brand/5 font-mono text-[11px] uppercase tracking-widest"
        >
          {demoLoading ? 'Demo hazırlanıyor…' : '🎁 Demo Site Aç (5 makale + audit + AI snapshot)'}
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Stage B — Mission progress (HUD wheel + polling)
// ──────────────────────────────────────────────────────────────────────
function MissionStage({
  siteId,
  onComplete,
  onAbort,
}: {
  siteId: string;
  onComplete: (id: string) => void;
  onAbort: () => void;
}) {
  // startedAt — siteId başına localStorage'da persist; F5'de sayaç sıfırlanmasın.
  const startedAtRef = useRef<number>(0);
  if (startedAtRef.current === 0) {
    const key = `luviai-mission-startedAt-${siteId}`;
    if (typeof window !== 'undefined') {
      try {
        const stored = window.localStorage.getItem(key);
        if (stored) {
          const v = parseInt(stored, 10);
          // Sadece son 30 dakika içinde başlamış görevleri kabul et
          if (!isNaN(v) && Date.now() - v < 30 * 60_000) {
            startedAtRef.current = v;
          }
        }
        if (startedAtRef.current === 0) {
          startedAtRef.current = Date.now();
          window.localStorage.setItem(key, String(startedAtRef.current));
        }
      } catch {
        startedAtRef.current = Date.now();
      }
    } else {
      startedAtRef.current = Date.now();
    }
  }
  const [tasks, setTasks] = useState<MissionTask[]>([
    { key: 'brain', label: 'Marka beyni', done: false },
    { key: 'audit', label: 'Site audit', done: false },
    { key: 'topics', label: 'İçerik konuları', done: false },
    { key: 'platform', label: 'Platform tespiti', done: false },
    { key: 'schedule', label: 'Yayın takvimi', done: false },
  ]);
  // Wow preview — her aşama biter bitmez user'a anında değer göster (Maya tarzı)
  const [wow, setWow] = useState<{
    platform?: string;
    competitors?: string[];
    persona?: string;
    siteScore?: number;
    topIssue?: string;
    topTopic?: string;
  }>({});
  // Stuck-check: 8 dk'dan uzun sürüyorsa kullanıcıya çıkış yolu sun
  const [stuck, setStuck] = useState(false);
  // Tick: her 30sn'de bir elapsed'i kontrol et
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      if (elapsed > 8 * 60_000) setStuck(true);
      forceTick((t) => t + 1);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Manuel retry: onboarding chain'i yeniden tetikle
  const [retrying, setRetrying] = useState(false);
  const handleRetryChain = async () => {
    setRetrying(true);
    try {
      await api.completeOnboarding(siteId);
      toast.success('Onboarding tekrar başlatıldı (1-2 dk)');
      setStuck(false);
      startedAtRef.current = Date.now();
      try { window.localStorage.setItem(`luviai-mission-startedAt-${siteId}`, String(startedAtRef.current)); } catch (_e) { /* noop */ }
    } catch (err: any) {
      toast.error(`Yeniden başlatılamadı: ${err.message}`);
    } finally {
      setRetrying(false);
    }
  };

  // Polling effect
  useEffect(() => {
    let cancelled = false;
    let timeoutId: any;

    const poll = async () => {
      try {
        const [siteR, brainR, auditR, queueR] = await Promise.allSettled([
          api.getSite(siteId),
          api.getBrain(siteId).catch(() => null),
          api.getLatestAudit(siteId).catch(() => null),
          api.getTopicQueue(siteId).catch(() => null),
        ]);
        if (cancelled) return;

        const site: any = siteR.status === 'fulfilled' ? siteR.value : null;
        const brain: any = brainR.status === 'fulfilled' ? brainR.value : null;
        const audit: any = auditR.status === 'fulfilled' ? auditR.value : null;
        const queue: any = queueR.status === 'fulfilled' ? queueR.value : null;

        // Site missing → silinmiş
        if (siteR.status === 'rejected' && (siteR.reason?.status === 404)) {
          toast.error('Site bulunamadı — yeniden başlatın');
          try { window.localStorage.removeItem(`luviai-mission-startedAt-${siteId}`); } catch (_e) { /* noop */ }
          onAbort();
          return;
        }

        const brainDone = !!brain;
        const auditDone = !!audit;
        const topicsDone = !!(queue?.tier1Topics?.length);
        const platformDone = !!(site?.platform);
        const scheduleDone = site?.status === 'ACTIVE';

        setTasks([
          { key: 'brain', label: 'Marka beyni', done: brainDone },
          { key: 'audit', label: 'Site audit', done: auditDone },
          { key: 'topics', label: 'İçerik konuları', done: topicsDone },
          { key: 'platform', label: 'Platform tespiti', done: platformDone },
          { key: 'schedule', label: 'Yayın takvimi', done: scheduleDone },
        ]);

        // Wow preview — her aşamadan ilk değerli sinyali çıkar
        setWow((prev) => ({
          platform: prev.platform ?? (site?.platform ? String(site.platform) : undefined),
          competitors: prev.competitors ?? (Array.isArray(brain?.competitors) && brain.competitors.length > 0
            ? brain.competitors.slice(0, 3).map((c: any) => typeof c === 'string' ? c : c?.name).filter(Boolean)
            : undefined),
          persona: prev.persona ?? (Array.isArray(brain?.personas) && brain.personas[0]
            ? (brain.personas[0]?.name ?? brain.personas[0]?.name)
            : undefined),
          siteScore: prev.siteScore ?? (audit?.overallScore ?? undefined),
          topIssue: prev.topIssue ?? (Array.isArray(audit?.issues) && audit.issues[0]?.title
            ? String(audit.issues[0].title)
            : undefined),
          topTopic: prev.topTopic ?? (queue?.tier1Topics?.[0]?.topic ?? undefined),
        }));

        // Tamamlandı → yönlendir
        if (scheduleDone || (brainDone && auditDone && topicsDone)) {
          // Kısa bir gösterim için 1.4sn bekle (HUD "done" state'i dönsün)
          setTimeout(() => {
            if (!cancelled) {
              try { window.localStorage.removeItem(`luviai-mission-startedAt-${siteId}`); } catch (_e) { /* noop */ }
              onComplete(siteId);
            }
          }, 1400);
          return;
        }
      } catch (_e) {
        // polling hatası — sessizce yeniden dene
      }
      if (!cancelled) timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();
    return () => { cancelled = true; if (timeoutId) clearTimeout(timeoutId); };
  }, [siteId, onComplete, onAbort]);

  return (
    <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-14">
      <div className="flex items-center justify-center gap-2 mb-2">
        <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand font-semibold">
          Mission #1 · Site Agent v0.7
        </span>
      </div>

      <MissionWheel tasks={tasks} startedAt={startedAtRef.current} estimatedMs={ESTIMATED_TOTAL_MS} />

      {/* Wow preview — aşamalar bittikçe AI'nın bulduklarını anında göster */}
      {(wow.platform || wow.competitors || wow.siteScore || wow.topTopic) && (
        <div className="mt-6 max-w-2xl mx-auto space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <p className="text-[10px] font-mono uppercase tracking-widest text-brand-600 text-center mb-2">
            ⚡ AI bulguları geliyor
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {wow.platform && (
              <div className="rounded-lg border bg-card p-3 flex items-center gap-2.5 hover:border-brand-500/30 transition">
                <span className="text-xl">🛠️</span>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Platform</p>
                  <p className="text-sm font-semibold truncate">{wow.platform}</p>
                </div>
              </div>
            )}
            {wow.persona && (
              <div className="rounded-lg border bg-card p-3 flex items-center gap-2.5 hover:border-brand-500/30 transition">
                <span className="text-xl">👤</span>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Hedef persona</p>
                  <p className="text-sm font-semibold truncate">{wow.persona}</p>
                </div>
              </div>
            )}
            {wow.competitors && wow.competitors.length > 0 && (
              <div className="rounded-lg border bg-card p-3 flex items-center gap-2.5 hover:border-brand-500/30 transition sm:col-span-2">
                <span className="text-xl">🎯</span>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{wow.competitors.length} rakip bulundu</p>
                  <p className="text-sm font-semibold truncate">{wow.competitors.join(' · ')}</p>
                </div>
              </div>
            )}
            {wow.siteScore !== undefined && (
              <div className="rounded-lg border bg-card p-3 flex items-center gap-2.5 hover:border-brand-500/30 transition">
                <span className="text-xl">📊</span>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Site skoru</p>
                  <p className="text-sm font-semibold">{wow.siteScore}/100</p>
                </div>
              </div>
            )}
            {wow.topIssue && (
              <div className="rounded-lg border bg-card p-3 flex items-center gap-2.5 hover:border-brand-500/30 transition">
                <span className="text-xl">⚠️</span>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">İlk düzeltilecek</p>
                  <p className="text-sm font-semibold truncate">{wow.topIssue}</p>
                </div>
              </div>
            )}
            {wow.topTopic && (
              <div className="rounded-lg border-2 border-brand-500/40 bg-brand-50/30 dark:bg-brand-950/10 p-3 flex items-center gap-2.5 sm:col-span-2">
                <span className="text-xl">✍️</span>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase font-bold text-brand-600 tracking-wider">İlk yazılacak içerik</p>
                  <p className="text-sm font-semibold truncate">{wow.topTopic}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stuck warning — 8 dakikadan uzun süren onboarding için kullanıcıya çıkış yolu */}
      {stuck && (
        <div className="mt-8 max-w-xl mx-auto rounded-2xl border-2 border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 grid place-items-center shrink-0 text-xl">
              ⏱
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-amber-900 dark:text-amber-100">İşlem normalden uzun sürüyor</h3>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-1 leading-relaxed">
                Genelde 1-3 dakikada biter. Şu an {Math.floor((Date.now() - startedAtRef.current) / 60_000)} dakikadır beklemedeyiz.
                Backend'deki onboarding zinciri yarıda kalmış olabilir (deploy, network gecikmesi, AI provider yavaşlığı).
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={handleRetryChain}
              disabled={retrying}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {retrying ? '↻ Yeniden başlatılıyor…' : '↻ Onboarding\'i yeniden başlat'}
            </button>
            <button
              type="button"
              onClick={() => {
                try { window.localStorage.removeItem(`luviai-mission-startedAt-${siteId}`); } catch (_e) { /* noop */ }
                onComplete(siteId);
              }}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-amber-500/40 hover:bg-amber-500/10 text-amber-800 dark:text-amber-200 text-sm font-semibold transition-colors"
            >
              → Dashboard'a git (eksikleri orada gör)
            </button>
          </div>
          <p className="text-[11px] text-amber-700 dark:text-amber-300 text-center">
            Backend tamamlandığında dashboard otomatik güncellenir. Bu ekranı kapatabilirsin.
          </p>
        </div>
      )}

      <div className="mt-10 flex items-center justify-center gap-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        <span className="opacity-70">SITE_ID: {siteId}</span>
        <span className="opacity-40">·</span>
        <button
          className="underline-offset-2 hover:text-foreground transition-colors hover:underline"
          onClick={() => {
            if (confirm('Görevi iptal et ve sıfırdan başla? Site backend\'de kalır.')) {
              try { window.localStorage.removeItem(`luviai-mission-startedAt-${siteId}`); } catch (_e) { /* noop */ }
              onAbort();
            }
          }}
        >
          görevi iptal et
        </button>
      </div>
    </div>
  );
}

function BootingNote() {
  return (
    <div className="max-w-2xl mx-auto py-16 text-center">
      <div className="inline-flex items-center gap-3 font-mono text-xs uppercase tracking-[0.2em] text-brand">
        <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
        <span>Mission console hazırlanıyor…</span>
      </div>
    </div>
  );
}
