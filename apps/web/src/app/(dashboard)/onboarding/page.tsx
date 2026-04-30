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

const POLL_INTERVAL_MS = 4000;
const ESTIMATED_TOTAL_MS = 90_000;
const RESUME_KEY = 'luviai-quickmission-active-site';

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
      const created = await api.createSite({
        url,
        name: guessedName,
        niche: 'diğer',
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
  const startedAtRef = useRef<number>(Date.now());
  const [tasks, setTasks] = useState<MissionTask[]>([
    { key: 'brain', label: 'Marka beyni', done: false },
    { key: 'audit', label: 'Site audit', done: false },
    { key: 'topics', label: 'İçerik konuları', done: false },
    { key: 'platform', label: 'Platform tespiti', done: false },
    { key: 'schedule', label: 'Yayın takvimi', done: false },
  ]);

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

        // Tamamlandı → yönlendir
        if (scheduleDone || (brainDone && auditDone && topicsDone)) {
          // Kısa bir gösterim için 1.4sn bekle (HUD "done" state'i dönsün)
          setTimeout(() => { if (!cancelled) onComplete(siteId); }, 1400);
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

      <div className="mt-10 flex items-center justify-center gap-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        <span className="opacity-70">SITE_ID: {siteId}</span>
        <span className="opacity-40">·</span>
        <button
          className="underline-offset-2 hover:text-foreground transition-colors hover:underline"
          onClick={() => {
            if (confirm('Görevi iptal et ve sıfırdan başla? Site backend\'de kalır.')) onAbort();
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
