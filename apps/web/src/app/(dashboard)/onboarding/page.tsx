'use client';

/*
 * HIZLI KURULUM — Tek sayfa, sıfır soru onboarding.
 *
 * Akış:
 *   Stage A (input)   — kullanıcı sadece site URL'ini girer
 *   Stage B (mission) — backend'in ONBOARDING_CHAIN job'u koşar:
 *                       brain → audit → topics → platform → schedule
 *                       Frontend 4sn'de bir polling yapar; site.status === 'ACTIVE'
 *                       olunca veya brain+audit+queue üçü hazır olunca
 *                       /sites/{id}?onboarding=done sayfasına yönlendirir.
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
import { motion } from 'motion/react';
import {
  AlertTriangle, ArrowRight, ChevronRight, Gift, Globe, Loader2, PenLine, RotateCw, Sparkles,
  Swords, Gauge, UserRound, Wrench,
} from 'lucide-react';
import { api } from '@/lib/api';
import { fadeUp, staggerContainer } from '@/lib/motion-presets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBanner } from '@/components/ui/status-banner';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import {
  MissionShell,
  MissionWheel,
  type MissionTask,
} from '@/components/ai-scan';

const POLL_INTERVAL_MS = 2000;          // 4s → 2s, ilk wow için
const ESTIMATED_TOTAL_MS = 60_000;       // 90s → 60s hedef
const RESUME_KEY = 'luviai-quickmission-active-site';
/**
 * Bayat anahtar TTL'i. NEDEN: anahtar yalniz gorev bitince siliniyordu; zinciri yarida
 * kalan bir site (orn. ONBOARDING_CHAIN "job stalled") gorevi HIC bitiremedigi icin anahtar
 * haftalarca kaliyor ve her "Yeni Site" tiklamasi o eski siteyi "devam ettiriyordu"
 * (02.09.2026 tespiti: 12.08'de eklenen site 3 hafta sonra hala aciliyordu).
 * Kural: yalniz son 30 dk icinde baslamis VE sunucuda hala onboarding'de olan gorev devam eder.
 */
const RESUME_TTL_MS = 30 * 60_000;

type ResumeKaydi = { siteId: string; at: number };

function resumeKaydiOku(): ResumeKaydi | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    // Eski format duz siteId string'iydi — tarihsiz oldugu icin bayat sayilir ve temizlenir
    if (!raw.startsWith('{')) { localStorage.removeItem(RESUME_KEY); return null; }
    const k = JSON.parse(raw) as Partial<ResumeKaydi>;
    if (!k.siteId || typeof k.at !== 'number') { localStorage.removeItem(RESUME_KEY); return null; }
    if (Date.now() - k.at > RESUME_TTL_MS) { localStorage.removeItem(RESUME_KEY); return null; }
    return { siteId: k.siteId, at: k.at };
  } catch { return null; }
}

function resumeKaydiYaz(siteId: string) {
  try { localStorage.setItem(RESUME_KEY, JSON.stringify({ siteId, at: Date.now() })); } catch (_e) { /* noop */ }
}

function resumeKaydiSil() {
  try { localStorage.removeItem(RESUME_KEY); } catch (_e) { /* noop */ }
}

/**
 * Devam edilebilir sunucu durumlari: ONBOARDING_CHAIN worker'i ACTIVE'i yalnizca zincirin
 * en sonunda yazar (apps/worker/src/index.ts); bu uc durum "zincir henuz bitmedi" demektir.
 */
const RESUMABLE_STATUSES = new Set(['ONBOARDING', 'AUDIT_PENDING', 'AUDIT_COMPLETE']);

/**
 * Sunucu gercegi: devam ANLAMSIZ ise true. Tamamlanma damgasi var, durum bitmis (ACTIVE/PAUSED/ERROR)
 * ya da site 30 dk'dan eski (zincir normalde 1-3 dk surer; daha eskisi olmus sayilir —
 * AUDIT_COMPLETE her haftalik taramada yeniden yazildigi icin tek basina "devam ediyor" kaniti degildir).
 */
function onboardingGecmis(site: any): boolean {
  if (!site) return false;
  if (site.onboardingCompletedAt) return true;
  if (!RESUMABLE_STATUSES.has(String(site.status))) return true;
  const olusturma = site.createdAt ? Date.parse(site.createdAt) : NaN;
  if (!Number.isNaN(olusturma) && Date.now() - olusturma > RESUME_TTL_MS) return true;
  return false;
}
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

  // ?siteId=X ile devam edilebilir (kullanıcı sayfayı yenilerse — onCreated URL'i buna cevirir)
  const queryId = params.get('siteId');
  // ?new=1 → "Yeni Site" niyeti: bayat anahtar ne olursa olsun TAZE form
  const yeniNiyeti = params.get('new') === '1';
  // ?url=https://... → unlock/landing akisindan gelen alan adi; forma onceden doldurulur
  const onDoluUrl = params.get('url') ?? '';
  const [resumeId, setResumeId] = useState<string | null>(queryId);
  const [hydratedResume, setHydratedResume] = useState(false);
  // Guncel niyet: hydrate'in asenkron dallari (getSite bekleme penceresi ≤8 sn) bittiginde
  // arada ?new=1 gelmis olabilir; gecikmis sonuc niyeti ezmesin diye ref'ten okunur.
  const yeniNiyetiRef = useRef(yeniNiyeti);
  yeniNiyetiRef.current = yeniNiyeti;

  useEffect(() => {
    let iptal = false;
    if (resumeId) { setHydratedResume(true); return; }
    if (yeniNiyeti || onDoluUrl) { resumeKaydiSil(); setHydratedResume(true); return; }
    const kayit = resumeKaydiOku();
    if (!kayit) { setHydratedResume(true); return; }
    // Anahtar taze; yine de sunucuya sor — site silinmis/baskasinin (404/403) ya da onboarding'i
    // bitmisse devam etme. Ag/5xx hatasinda sunucu gercegi bilinmiyor → anahtar KORUNUR, devam edilir
    // (MissionStage kendi 404/403 kontrolunu yapar). 8 sn zaman asimi: API asili kalirsa sayfa
    // "Hazirlaniyor" ekraninda kilitlenmesin — devam et, polling kendi halleder.
    Promise.race([
      api.getSite(kayit.siteId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ])
      .then((site) => {
        if (iptal) return;
        if (yeniNiyetiRef.current) { resumeKaydiSil(); return; } // bekleme sirasinda "Yeni Site" dendi
        if (site === null) { setResumeId(kayit.siteId); return; } // zaman asimi: devam et
        if (onboardingGecmis(site)) { resumeKaydiSil(); return; }
        setResumeId(kayit.siteId);
      })
      .catch((err: any) => {
        if (iptal) return;
        if (yeniNiyetiRef.current) { resumeKaydiSil(); return; }
        if (err?.status === 404 || err?.status === 403) { resumeKaydiSil(); return; }
        setResumeId(kayit.siteId);
      })
      .finally(() => { if (!iptal) setHydratedResume(true); });
    return () => { iptal = true; };
  }, []); // yalniz ilk mount: ilk yuklemedeki niyet/anahtar degerlendirilir

  /**
   * Ayni sayfada yalniz arama parametresi degisen navigasyon (orn. Mission ekranindayken Cmd+K
   * "Yeni Site Ekle" → ?new=1) App Router'da bileseni YENIDEN MOUNT ETMEZ; ilk-mount effect'i
   * kosmaz. Bu effect niyeti/siteId'yi state'e senkronlar.
   */
  useEffect(() => {
    if (yeniNiyeti) { resumeKaydiSil(); if (resumeId) setResumeId(null); return; }
    if (queryId && queryId !== resumeId) setResumeId(queryId);
  }, [yeniNiyeti, queryId]); // resumeId bilerek disarida: yalniz URL degisince kossun

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
            resumeKaydiSil();
            // replace: onCreated adres cubugunu ?siteId=X yaptigi icin push ile gidilirse Geri tusu
            // Mission ekranina duser ve 1.4 sn sonra yeniden /sites/X'e itilir (geri tusu tuzagi)
            router.replace(`/sites/${id}?onboarding=done`);
          }}
          onAbort={() => {
            resumeKaydiSil();
            setResumeId(null);
            router.replace('/onboarding?new=1');
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
        initialUrl={onDoluUrl}
        onCreated={(siteId) => {
          resumeKaydiYaz(siteId);
          setResumeId(siteId);
          // F5 sozlesmesi: adres cubugunda siteId dursun — devam localStorage'a muhtac olmasin
          router.replace(`/onboarding?siteId=${encodeURIComponent(siteId)}`);
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
  initialUrl = '',
}: {
  sessionUserId: string | null;
  sessionStatus: 'authenticated' | 'unauthenticated' | 'loading';
  onCreated: (siteId: string) => void;
  /** ?url= ile gelen alan adi (unlock/landing) — eskiden okunmuyordu, parametre bosa gidiyordu */
  initialUrl?: string;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [creating, setCreating] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  // "siteniz.com" yazan kullanici dugmeyi gri gorup takiliyordu (https:// sarti,
  // uyari da devre disi dugme yuzunden hic cikmiyordu) → sema yoksa https eklenir.
  const normalized = (() => {
    const t = url.trim();
    if (!t) return '';
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  })();
  const valid = (() => {
    try {
      const u = new URL(normalized);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
    } catch { return false; }
  })();
  const showHint = url.trim().length > 3 && !valid;

  const submit = async () => {
    if (!valid) { toast.error('Geçerli bir alan adı gir (ör. siteniz.com)'); return; }
    if (sessionStatus !== 'authenticated' || !sessionUserId) {
      router.push(`/signin?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    setCreating(true);
    try {
      const guessedName = (() => {
        try { return new URL(normalized).hostname.replace(/^www\./, '').split('.')[0]; }
        catch { return 'Site'; }
      })();

      // AI ile niş tespit — site oluşturmadan önce paralel başlat.
      // Başarısız olursa 'diğer' fallback, akış kesilmez.
      let detectedNiche = 'diğer';
      let detectedCustomNiche: string | undefined;
      try {
        const detection = await Promise.race([
          api.detectNiche(normalized),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)), // 12sn cap
        ]);
        if (detection && (detection as any).niche) {
          const d = detection as any;
          // Confidence yüksekse: standart niş enum'u `niche`'e, serbest metin niş
          // ise AYRI `customNiche` alanına yazılır (backend ikisini ayrı saklar).
          if (d.confidence >= 0.5) {
            detectedNiche = d.niche;
            if (d.niche === 'diğer' && d.customNiche) {
              detectedCustomNiche = d.customNiche;
            }
            toast.success(`Niş tespit edildi: ${detectedCustomNiche || detectedNiche}`);
          }
        }
      } catch (_e) { /* fallback to 'diğer' */ }

      const created = await api.createSite({
        url: normalized,
        name: guessedName,
        niche: detectedNiche,
        customNiche: detectedCustomNiche,
        language: 'tr',
      } as any);
      toast.success('Analiz başladı — AI çalışıyor');
      onCreated(created.id);
    } catch (err: any) {
      toast.error(err.message);
      setCreating(false);
    }
  };

  const launchDemo = async () => {
    if (sessionStatus !== 'authenticated') {
      router.push(`/signin?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
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
      <p className="mb-3 flex items-center justify-center gap-1.5 text-label text-brand">
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> İlk siteni ekle
      </p>

      <h1 className="mb-3 text-center text-h4 font-semibold tracking-tight sm:text-h3">
        Tek tek adımları unut.
      </h1>
      <p className="mx-auto mb-8 max-w-lg text-center text-base text-muted-foreground sm:text-lg">
        Sadece site adresini gir. AI markanı, rakiplerini ve hedef kitleni tespit edip
        SEO + GEO skorunu hesaplar ve içerik takvimini hazırlar — ortalama <span className="font-semibold text-foreground">60–90 sn</span>.
      </p>

      <div className="rounded-lg border border-brand/30 bg-card/80 p-1 shadow-apple-md backdrop-blur-sm focus-within:border-brand/60">
        <div className="flex items-center gap-2 p-1">
          <Globe className="ml-3 h-5 w-5 shrink-0 text-brand/70" aria-hidden />
          <Input
            type="url"
            inputMode="url"
            placeholder="siteniz.com"
            aria-label="Site adresi"
            aria-invalid={showHint || undefined}
            aria-describedby="site-url-hint"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && valid && !creating) submit(); }}
            autoFocus
            className="h-14 border-0 bg-transparent px-2 text-lg focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <Button onClick={submit} disabled={!valid || creating} size="lg" className="mr-1 h-12 shrink-0 px-5">
            {creating ? (
              <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Başlatılıyor…</>
            ) : (
              <>Analizi başlat <ChevronRight className="h-4 w-4" aria-hidden /></>
            )}
          </Button>
        </div>
      </div>

      <p id="site-url-hint" className={cn('mt-2 text-label', showHint ? 'text-danger' : 'text-muted-foreground')}>
        {showHint ? 'Bu bir alan adına benzemiyor — ör. siteniz.com' : 'https:// yazmana gerek yok.'}
      </p>

      <ul className="mt-8 grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
        {[
          { title: 'Marka beyni', sub: 'Marka sesi, persona ve rakip analizi' },
          { title: 'SEO + GEO skoru', sub: '14 SEO kontrolü ve AI atıf analizi' },
          { title: 'Hazır içerik takvimi', sub: 'İlk başlıklar otomatik planlanır' },
        ].map((f) => (
          <li key={f.title} className="rounded-lg border bg-card/60 p-3 backdrop-blur-sm">
            <p className="text-sm font-semibold">{f.title}</p>
            <p className="mt-0.5 text-label text-muted-foreground">{f.sub}</p>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex flex-col items-center justify-center gap-2 text-sm sm:flex-row sm:gap-3">
        <span className="text-label text-muted-foreground">ya da önce göz at</span>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={launchDemo}
          disabled={demoLoading}
        >
          {demoLoading
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Demo hazırlanıyor…</>
            : <><Gift className="h-3.5 w-3.5" aria-hidden /> Demo siteyi aç</>}
        </Button>
      </div>
      <p className="mt-1.5 text-center text-label text-muted-foreground">Demo: 5 yazı, site taraması ve AI ölçümüyle hazır gelir.</p>
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
    { key: 'audit', label: 'Site taraması', done: false },
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

  const confirm = useConfirm();

  // Manuel retry: onboarding chain'i yeniden tetikle
  const [retrying, setRetrying] = useState(false);
  const handleRetryChain = async () => {
    setRetrying(true);
    try {
      await api.completeOnboarding(siteId);
      toast.success('Kurulum yeniden başladı (1-2 dk)');
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

        // Site yok (404) ya da baska kullaniciya ait bayat id (403, assertOwnership) → gorevi iptal et
        if (siteR.status === 'rejected' && (siteR.reason?.status === 404 || siteR.reason?.status === 403)) {
          toast.error('Site bulunamadı — baştan başlayalım');
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
          { key: 'audit', label: 'Site taraması', done: auditDone },
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

  const elapsedMin = Math.floor((Date.now() - startedAtRef.current) / 60_000);
  const findings = [
    wow.platform && { key: 'platform', icon: Wrench, label: 'Platform', value: wow.platform },
    wow.persona && { key: 'persona', icon: UserRound, label: 'Hedef persona', value: wow.persona },
    wow.competitors && wow.competitors.length > 0 && {
      key: 'competitors', icon: Swords, label: `${wow.competitors.length} rakip bulundu`, value: wow.competitors.join(' · '), wide: true,
    },
    wow.siteScore !== undefined && { key: 'score', icon: Gauge, label: 'Site skoru', value: `${wow.siteScore}/100` },
    wow.topIssue && { key: 'issue', icon: AlertTriangle, label: 'İlk düzeltilecek', value: wow.topIssue },
    wow.topTopic && { key: 'topic', icon: PenLine, label: 'İlk yazılacak içerik', value: wow.topTopic, wide: true, highlight: true },
  ].filter(Boolean) as Array<{ key: string; icon: React.ComponentType<{ className?: string }>; label: string; value: string; wide?: boolean; highlight?: boolean }>;

  return (
    <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-14">
      <p className="mb-2 text-center text-label text-brand">Siten hazırlanıyor</p>

      <MissionWheel tasks={tasks} startedAt={startedAtRef.current} estimatedMs={ESTIMATED_TOTAL_MS} />

      {/* Ilk bulgular — asamalar bittikce AI'nin bulduklarini aninda goster */}
      {findings.length > 0 && (
        <div className="mx-auto mt-6 max-w-2xl space-y-2">
          <p className="mb-2 text-center text-label text-muted-foreground">İlk bulgular</p>
          <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {findings.map((f) => {
              const Icon = f.icon;
              return (
                <motion.li
                  key={f.key}
                  variants={fadeUp}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border bg-card p-3',
                    f.wide && 'sm:col-span-2',
                    f.highlight && 'border-brand/40 bg-brand/5',
                  )}
                >
                  <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md', f.highlight ? 'bg-brand/15 text-brand' : 'bg-muted text-muted-foreground')}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className={cn('text-label', f.highlight ? 'text-brand' : 'text-muted-foreground')}>{f.label}</p>
                    <p className="truncate text-sm font-semibold">{f.value}</p>
                  </div>
                </motion.li>
              );
            })}
          </motion.ul>
        </div>
      )}

      {/* 8 dakikadan uzun suren kurulum icin cikis yolu */}
      {stuck && (
        <div className="mx-auto mt-8 max-w-xl space-y-3">
          <StatusBanner tone="warning" title="İşlem normalden uzun sürüyor">
            Genelde 1-3 dakikada biter; {elapsedMin} dakikadır bekliyoruz. Kurulum zinciri yarıda kalmış olabilir
            (sunucu güncellemesi, ağ gecikmesi ya da AI sağlayıcısının yavaşlığı).
          </StatusBanner>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" onClick={handleRetryChain} disabled={retrying}>
              <RotateCw className={cn('h-4 w-4', retrying && 'animate-spin motion-reduce:animate-none')} aria-hidden />
              {retrying ? 'Yeniden başlatılıyor…' : 'Kurulumu yeniden başlat'}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                try { window.localStorage.removeItem(`luviai-mission-startedAt-${siteId}`); } catch (_e) { /* noop */ }
                onComplete(siteId);
              }}
            >
              Panele git <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <p className="text-center text-label text-muted-foreground">
            Eksikleri panelde görürsün; kurulum tamamlanınca panel kendiliğinden güncellenir.
          </p>
        </div>
      )}

      <div className="mt-10 text-center">
        <button
          type="button"
          className="text-label text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          onClick={async () => {
            const ok = await confirm({
              title: 'Kurulum iptal edilsin mi?',
              description: 'Baştan başlarsın. Eklediğin site silinmez; Sitelerim listesinde kalır.',
              confirmLabel: 'İptal et',
              cancelLabel: 'Devam et',
            });
            if (ok) {
              try { window.localStorage.removeItem(`luviai-mission-startedAt-${siteId}`); } catch (_e) { /* noop */ }
              onAbort();
            }
          }}
        >
          İptal et ve baştan başla
        </button>
      </div>
    </div>
  );
}

function BootingNote() {
  return (
    <div className="mx-auto flex max-w-2xl items-center justify-center gap-2 py-16 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin text-brand motion-reduce:animate-none" aria-hidden />
      Hazırlanıyor…
    </div>
  );
}
