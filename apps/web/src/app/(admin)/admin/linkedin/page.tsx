'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  api,
  type LinkedinImportRow,
  type LinkedinKampanya,
  type LinkedinOverview,
  type LinkedinProspect,
  type LinkedinProspectStatus,
  type LinkedinTickResult,
} from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  Users, RefreshCw, Pause, Play, FlaskConical, Send, Upload,
  AlertTriangle, SkipForward, Camera, ExternalLink, CheckCircle2, XCircle, MessageSquareText, Link2, Search,
} from 'lucide-react';

/** Kampanya turleri — arka uctaki LinkedinKampanya ile birebir */
const KAMPANYA: Array<{ key: LinkedinKampanya; label: string; aciklama: string }> = [
  { key: 'MUSTERI', label: 'Müşteri adayı', aciklama: 'AI görünürlük araştırması daveti — ücretsiz karne' },
  { key: 'YATIRIMCI', label: 'Yatırımcı', aciklama: 'Ürün tanıtımı + 20 dakikalık tanışma görüşmesi' },
  { key: 'ISBIRLIGI', label: 'İş birliği', aciklama: 'Ajans / çözüm ortaklığı — ortak müşteri çalışması' },
];
const KAMPANYA_LABEL: Record<string, string> = Object.fromEntries(KAMPANYA.map((k) => [k.key, k.label]));

/**
 * LinkedIn outreach botu — kurucu hesabindan siki frenli baglanti istegi
 * ve mesaj. Bu sayfa yalniz IZLEME ve FREN icindir: kuyruk, sayaclar,
 * duraklat/devam, kuru/gercek tick, CSV ice aktarma. Bot mantigi
 * apps/api/src/intel/linkedin-outreach.service.ts'te; worker tick atar.
 *
 * NEDEN limitler arka uctan: fren sabitleri kodda ama env ile asagi
 * cekilebilir; panel kendi kopyasini tasisaydi "kac kaldi" yanlis olurdu.
 * overview.limits yoksa (eski API) kod varsayilanlari gosterilir.
 */

const VARSAYILAN_LIMIT = { dayRequests: 20, dayMessages: 15, weekRequests: 80 } as const;
/** Olgun kabul orani (72 sa–14 gun) bu esigin altina inerse bot kendini duraklatir (spam sinyali) */
const ACCEPT_RATE_FLOOR_PCT = 15;

const STATUS_META: Record<LinkedinProspectStatus, { label: string; variant: any; cls?: string }> = {
  QUEUED: { label: 'Kuyrukta', variant: 'secondary' },
  REQUESTED: { label: 'İstek gönderildi', variant: 'warning' },
  ACCEPTED: { label: 'Kabul etti', variant: 'success' },
  MESSAGED: { label: 'Mesaj gönderildi', variant: 'default' },
  REPLIED: { label: 'Cevap verdi', variant: 'success', cls: 'ring-2 ring-emerald-500/40' },
  SKIPPED: { label: 'Atlandı', variant: 'outline' },
  FAILED: { label: 'Hata', variant: 'destructive' },
};

const SEKTOR_LABEL: Record<string, string> = {
  finans: 'Finans',
  'eticaret-perakende-teknoloji': 'E-tic/Perakende/Tek',
  'turizm-havayolu-telekom-otomotiv': 'Turizm/Hav/Tel/Oto',
};

function fmtDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return d;
  }
}

/** Arka uc ORAN (0-1) doner — sozlesme api.ts LinkedinOverview.acceptRate7d */
function ratePct(r: number | null | undefined): number | null {
  if (r === null || r === undefined || Number.isNaN(r)) return null;
  return r * 100;
}

/** Arka uc limit anahtarlari (rules: MAX_REQUESTS_PER_DAY vb.); yoksa kod varsayilani */
function limitOf(limits: Record<string, number> | undefined, keys: string[], fallback: number): number {
  for (const k of keys) {
    const v = limits?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return fallback;
}

// ═══════════════════════════════════════════════════════════════
//  CSV ayristirma (yapistirilan metin) — ad,soyad,firma,unvan,sektor,kademe,profileUrl
// ═══════════════════════════════════════════════════════════════

/** Tek satiri ayirici + cift tirnak kurallariyla boler ("a, b" tek alan kalir) */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Ayirici: ilk dolu satirda en cok gecen (; , tab) — Excel TR ';' verir */
function detectSep(line: string): string {
  const adaylar = [',', ';', '\t'];
  let best = ',';
  let bestN = -1;
  for (const s of adaylar) {
    const n = line.split(s).length - 1;
    if (n > bestN) { best = s; bestN = n; }
  }
  return best;
}

/**
 * Profil URL'sini kanonik hale getir: https://www.linkedin.com/in/<slug>/
 * NEDEN: www./cipsiz, tr.linkedin.com, ?trk=..., #, buyuk-kucuk harf varyantlari
 * ayni kisidir; arka uc profileUrl @unique oldugundan kanonik olmayan girdi
 * ayni kisi icin ikinci satir uretirdi.
 */
function canonicalProfileUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^(?!https?:\/\/)/, 'https://'));
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/in\/([^/?#\s]+)/i);
  if (!m) return null;
  let slug: string;
  try { slug = decodeURIComponent(m[1]); } catch { slug = m[1]; }
  slug = slug.toLowerCase();
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
}

function parseImportText(text: string): { rows: LinkedinImportRow[]; hatalar: string[] } {
  const rows: LinkedinImportRow[] = [];
  const hatalar: string[] = [];
  const rawLines = text.split(/\r?\n/);
  const firstNonEmpty = rawLines.find((l) => l.trim());
  if (!firstNonEmpty) return { rows, hatalar };

  const sep = detectSep(firstNonEmpty);
  const gorulen = new Set<string>();
  let basliqAtlandi = false;

  // NEDEN ham satir numarasi: bos satirlar atilinca "Satir N" kayiyordu
  rawLines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    const satir = idx + 1;
    const cols = splitCsvLine(line, sep);
    if (!basliqAtlandi) {
      basliqAtlandi = true;
      const low = cols.map((c) => c.toLowerCase());
      if (low.includes('profileurl') || (low[0] === 'ad' && low[1] === 'soyad')) return;
    }
    const [ad = '', soyad = '', firma = '', unvan = '', sektor = '', kademeRaw = '', profileRaw = ''] = cols;

    if (!ad || !soyad || !firma || !profileRaw) {
      hatalar.push(`Satır ${satir}: ad, soyad, firma ve profileUrl zorunlu`);
      return;
    }
    const profileUrl = canonicalProfileUrl(profileRaw);
    if (!profileUrl) {
      hatalar.push(`Satır ${satir}: profileUrl linkedin.com/in/... biçiminde olmalı`);
      return;
    }
    if (gorulen.has(profileUrl)) {
      hatalar.push(`Satır ${satir}: aynı profil tekrar ediyor, atlandı`);
      return;
    }
    gorulen.add(profileUrl);

    const kademeN = parseInt(kademeRaw, 10);
    const kademe = kademeN === 1 || kademeN === 2 ? kademeN : undefined;
    if (kademeRaw && kademe === undefined) hatalar.push(`Satır ${satir}: kademe 1 veya 2 olmalı (boş bırakıldı)`);

    rows.push({
      ad, soyad, firma,
      unvan: unvan || undefined,
      sektor: sektor || undefined,
      kademe,
      profileUrl,
    });
  });

  return { rows, hatalar };
}

// ═══════════════════════════════════════════════════════════════
//  SAYFA
// ═══════════════════════════════════════════════════════════════

type LastTick = { dryRun: boolean; at: Date; result: LinkedinTickResult };

export default function AdminLinkedinPage() {
  const [overview, setOverview] = useState<LinkedinOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTick, setLastTick] = useState<LastTick | null>(null);
  const [forceDry, setForceDry] = useState(false);
  const [acik, setAcik] = useState<string | null>(null);
  const [firmaFiltre, setFirmaFiltre] = useState<string>('hepsi');
  const [durumFiltre, setDurumFiltre] = useState<string>('hepsi');

  const load = useCallback(async (sessiz = false) => {
    try {
      setOverview(await api.getLinkedinOverview());
    } catch (err: any) {
      if (!sessiz) toast.error(`Genel durum alınamadı: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Worker arka planda tick atiyor; sayfa acikken sayaclar kendiliginden tazelensin
  useEffect(() => {
    const t = setInterval(() => load(true), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err: any) {
      toast.error(err?.message ?? 'İşlem başarısız');
    } finally {
      setBusy(null);
    }
  };

  const pause = () => {
    const reason = window.prompt('Duraklatma nedeni (isteğe bağlı):', 'Elle duraklatıldı');
    if (reason === null) return; // vazgecti
    run('pause', async () => {
      await api.pauseLinkedin(reason.trim() || undefined);
      toast.success('Bot duraklatıldı — worker tick atsa da işlem yapmaz');
      await load();
    });
  };

  const resume = () => run('resume', async () => {
    await api.resumeLinkedin();
    toast.success('Bot devam ediyor');
    await load();
  });

  const tick = (dryRun: boolean) => {
    if (!dryRun) {
      const ok = window.confirm(
        'GERÇEK tick: LinkedIn\'de gerçekten bağlantı isteği / mesaj gönderilir (tick başına en fazla 3 işlem, işlemler arası 2-6 dk). Arka planda çalışır; sonuç tabloda görünür. Devam edilsin mi?',
      );
      if (!ok) return;
    }
    run(dryRun ? 'dry' : 'real', async () => {
      const result = await api.tickLinkedin({ dryRun, force: dryRun && forceDry });
      if (!dryRun && result?.started) {
        // NEDEN arka plan: gercek tick 5-20 dk surer; ters vekil senkron istegi keser
        toast.success('Gerçek tick arka planda başladı — sonuçlar 1-2 dk içinde tabloda ve durum kartında');
        setLastTick({ dryRun, at: new Date(), result: { actions: [], started: true, reason: result.reason } });
        window.setTimeout(() => load(true), 45_000);
        window.setTimeout(() => load(true), 180_000);
        return;
      }
      setLastTick({ dryRun, at: new Date(), result: result ?? { actions: [] } });
      const n = result?.actions?.length ?? 0;
      const hatali = result?.actions?.filter((a) => !a.ok).length ?? 0;
      if (result?.paused) toast.warning('Tick bot\'u duraklattı — nedeni durum kartında');
      else if (result?.reason && n === 0) toast.info(result.reason);
      else if (hatali) toast.warning(`${n} işlem, ${hatali} hatalı`);
      else toast.success(dryRun ? `Kuru tick bitti: ${n} işlem (gönderim yok)` : `Tick bitti: ${n} işlem`);
      await load();
    });
  };

  const skip = (p: LinkedinProspect) => run(`skip:${p.id}`, async () => {
    await api.skipLinkedinProspect(p.id);
    toast.success(`${p.ad} ${p.soyad} atlandı`);
    await load();
  });

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const paused = overview?.paused ?? false;
  const enabled = overview?.enabled ?? true;
  const inWindow = overview?.workWindow;
  const today = overview?.today ?? { requests: 0, messages: 0 };
  const week = overview?.week ?? { requests: 0 };
  const acceptPct = ratePct(overview?.acceptRate7d);
  const base = overview?.acceptRateBase;
  const recentAll = overview?.recent ?? [];
  const byFirma = overview?.byFirma ?? [];
  // NEDEN filtre: kuyruk 100+ satira cikti; firma/durum secmeden gozden gecirmek zor (30.08)
  const recent = recentAll.filter(
    (p) => (firmaFiltre === 'hepsi' || p.firma === firmaFiltre) && (durumFiltre === 'hepsi' || p.status === durumFiltre),
  );
  const toplamKayit = overview?.recentTotal ?? recentAll.length;
  const L = overview?.limits;
  const limit = {
    dayRequests: limitOf(L, ['MAX_REQUESTS_PER_DAY', 'maxRequestsPerDay'], VARSAYILAN_LIMIT.dayRequests),
    dayMessages: limitOf(L, ['MAX_MESSAGES_PER_DAY', 'maxMessagesPerDay'], VARSAYILAN_LIMIT.dayMessages),
    weekRequests: limitOf(L, ['MAX_REQUESTS_PER_WEEK', 'maxRequestsPerWeek'], VARSAYILAN_LIMIT.weekRequests),
  };

  return (
    <div className="space-y-6">
      {/* ── Başlık + düğmeler ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            LinkedIn Outreach
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Kurucu hesabından sıkı frenli bağlantı isteği + mesaj. Worker hafta içi 09–18 arası ~30 dakikada bir tick atar
            (%25&apos;i rastgele atlanır); cevap gelince bot susar, insan devralır.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button size="sm" variant="outline" onClick={() => load()} disabled={!!busy}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Yenile
          </Button>
          {paused ? (
            <Button size="sm" onClick={resume} disabled={!!busy}>
              {busy === 'resume' ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
              Devam
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={pause} disabled={!!busy}>
              {busy === 'pause' ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Pause className="h-3.5 w-3.5 mr-1.5" />}
              Duraklat
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => tick(true)} disabled={!!busy || !enabled} title={!enabled ? 'OPENCLAW_LINKEDIN_OUTREACH_ENABLED=1 değil' : 'Açar, okur, doldurur; GÖNDERMEZ'}>
            {busy === 'dry' ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5 mr-1.5" />}
            Kuru tick
          </Button>
          <label className="text-xs text-muted-foreground flex items-center gap-1 select-none" title="Kuru tick'i 09-18 penceresi dışında da çalıştır">
            <input type="checkbox" checked={forceDry} onChange={(e) => setForceDry(e.target.checked)} />
            pencere dışı (kuru)
          </label>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => tick(false)}
            disabled={!!busy || paused || !enabled}
            title={!enabled ? 'Bayrak kapalı' : paused ? 'Bot duraklatılmış' : 'Gerçekten gönderir — onay ister, arka planda çalışır'}
          >
            {busy === 'real' ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
            Gerçek tick
          </Button>
        </div>
      </div>

      {/* ── Uyarı ── */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <span className="font-medium">LinkedIn otomasyonu kullanım koşullarına aykırıdır; hesap kısıtlanabilir.</span>{' '}
          Günde ≤{limit.dayRequests} istek, ≤{limit.dayMessages} mesaj; haftada ≤{limit.weekRequests} istek. Limit/captcha/giriş duvarı
          görülürse bot kendini duraklatır. DM de ticari elektronik ileti sayılabilir — İYS/KVKK rejimi e-posta listesiyle aynıdır.
        </div>
      </div>

      {/* ── Sayaçlar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Counter label="Bugün istek" value={today.requests} limit={limit.dayRequests} />
        <Counter label="Bugün mesaj" value={today.messages} limit={limit.dayMessages} />
        <Counter label="Hafta istek" value={week.requests} limit={limit.weekRequests} />
        <Counter label="Kuyruk" value={overview?.queued ?? 0} />
        <Card className={cn('border', acceptPct !== null && acceptPct < ACCEPT_RATE_FLOOR_PCT && 'border-rose-500/40 bg-rose-500/5')}>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Kabul oranı (olgun 72s–14g)</div>
            <div className="text-3xl font-semibold mt-2 tabular-nums">
              {acceptPct === null ? '—' : `%${acceptPct.toFixed(0)}`}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              {acceptPct === null
                ? `henüz örnek yok${base ? ` (${base.requests}/${base.minRequests} olgun istek)` : ''}`
                : `${base ? `${base.accepted}/${base.requests} · ` : ''}%${ACCEPT_RATE_FLOOR_PCT} altı → oto-duraklama`}
            </div>
          </CardContent>
        </Card>
        <Card className={cn('border', !enabled ? 'border-zinc-500/40 bg-zinc-500/5' : paused ? 'border-rose-500/40 bg-rose-500/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Durum</div>
            <div className={cn('text-xl font-semibold mt-2 flex items-center gap-1.5', !enabled ? 'text-zinc-500' : paused ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
              {!enabled ? <Pause className="h-4 w-4" /> : paused ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {!enabled ? 'Bayrak kapalı' : paused ? 'Duraklatıldı' : 'Çalışıyor'}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2" title={overview?.pauseReason ?? ''}>
              {!enabled
                ? 'OPENCLAW_LINKEDIN_OUTREACH_ENABLED=1 değil'
                : paused
                  ? (overview?.pauseReason || 'neden belirtilmedi')
                  : inWindow === undefined ? '' : inWindow ? 'çalışma penceresinde (09–18 TR)' : 'pencere dışı — tick beklemede'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Son tick sonucu ── */}
      {lastTick && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm font-medium flex items-center gap-2">
                {lastTick.dryRun ? <FlaskConical className="h-4 w-4 text-sky-500" /> : <Send className="h-4 w-4 text-primary" />}
                {lastTick.dryRun ? 'Kuru tick' : 'Gerçek tick'} — {lastTick.at.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                {lastTick.result.paused && <Badge variant="warning">bot duraklatıldı</Badge>}
                {lastTick.result.started && <Badge variant="secondary">arka planda çalışıyor</Badge>}
              </div>
              <span className="text-xs text-muted-foreground">{lastTick.result.actions.length} işlem</span>
            </div>
            {lastTick.result.started ? (
              <div className="text-sm text-muted-foreground">Gerçek tick arka planda; işlemler arası 2-6 dk bekleme var. Tablo 45 sn ve 3 dk sonra kendiliğinden yenilenir.</div>
            ) : lastTick.result.actions.length === 0 ? (
              <div className="text-sm text-muted-foreground">{lastTick.result.reason || 'Yapılacak işlem yoktu (kuyruk boş, saat penceresi dışı ya da limit dolu).'}</div>
            ) : (
              <ul className="text-sm space-y-1">
                {lastTick.result.actions.map((a, i) => {
                  const p = a.prospectId ? recent.find((r) => r.id === a.prospectId) : undefined;
                  return (
                    <li key={i} className="flex items-start gap-2">
                      {a.ok
                        ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
                        : <XCircle className="h-4 w-4 mt-0.5 text-rose-500 shrink-0" />}
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">{a.type}</span>
                      {p && <span className="font-medium">{p.ad} {p.soyad}</span>}
                      {!p && a.prospectId && <span className="font-mono text-xs text-muted-foreground">{a.prospectId}</span>}
                      {a.note && <span className="text-muted-foreground">— {a.note}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Arama linkleriyle tarama ── */}
      <SearchUrlCard onDone={load} disabled={!!busy} />

      {/* ── CSV içe aktar ── */}
      <ImportCard onDone={load} disabled={!!busy} />

      {/* ── Firma dağılımı ── */}
      {byFirma.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium mb-3">Firma dağılımı <span className="text-muted-foreground font-normal">— {byFirma.length} firma, {byFirma.reduce((a, f) => a + f.kuyrukta, 0)} kişi kuyrukta</span></div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFirmaFiltre('hepsi')}
                className={cn('px-2.5 py-1.5 rounded-md border text-xs transition-colors', firmaFiltre === 'hepsi' ? 'bg-orange-500 text-white border-orange-500' : 'hover:bg-muted')}
              >
                Hepsi <span className="opacity-70">({toplamKayit})</span>
              </button>
              {byFirma.map((f) => (
                <button
                  key={f.firma}
                  type="button"
                  onClick={() => setFirmaFiltre(firmaFiltre === f.firma ? 'hepsi' : f.firma)}
                  className={cn('px-2.5 py-1.5 rounded-md border text-xs transition-colors', firmaFiltre === f.firma ? 'bg-orange-500 text-white border-orange-500' : 'hover:bg-muted')}
                  title={`${f.toplam} kayıt, ${f.kuyrukta} kuyrukta`}
                >
                  {f.firma} <span className="opacity-70">({f.kuyrukta})</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Son kayıtlar ── */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">
              {recent.length} kayıt gösteriliyor
              <span className="text-muted-foreground font-normal"> — toplam {toplamKayit}{recentAll.length < toplamKayit ? ` (son ${recentAll.length} yüklendi)` : ''}</span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={durumFiltre}
                onChange={(e) => setDurumFiltre(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-xs"
                aria-label="Durum filtresi"
              >
                <option value="hepsi">Tüm durumlar</option>
                {Object.entries(STATUS_META).map(([k, m]) => (
                  <option key={k} value={k}>{m.label}</option>
                ))}
              </select>
              <div className="text-xs text-muted-foreground">Ekran görüntüleri <span className="font-mono">data/linkedin/</span></div>
            </div>
          </div>
          {recent.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">
              Henüz kayıt yok. Yukarıdan CSV yapıştırıp içe aktar; ilk denemeyi <span className="font-medium">Kuru tick</span> ile yap.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Kişi</th>
                  <th className="px-4 py-3 font-medium">Firma / Ünvan</th>
                  <th className="px-4 py-3 font-medium">Sektör</th>
                  <th className="px-4 py-3 font-medium">Durum</th>
                  <th className="px-4 py-3 font-medium">Tarihler</th>
                  <th className="px-4 py-3 font-medium">Hata</th>
                  <th className="px-4 py-3 font-medium">Metin</th>
                  <th className="px-4 py-3 font-medium">Görüntü</th>
                  <th className="px-4 py-3 font-medium text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p) => {
                  const meta = STATUS_META[p.status] ?? { label: p.status, variant: 'outline' };
                  const tarihler = [
                    ['istek', p.requestedAt], ['kabul', p.acceptedAt], ['mesaj', p.messagedAt], ['cevap', p.repliedAt],
                  ].filter(([, d]) => !!d) as Array<[string, string]>;
                  const skipDisabled = p.status === 'SKIPPED' || busy === `skip:${p.id}`;
                  const metinVar = !!(p.noteText || p.messageText);
                  const acikMi = acik === p.id;
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium whitespace-nowrap">{p.ad} {p.soyad}</div>
                        <a
                          href={p.profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-orange-600 hover:underline inline-flex items-center gap-1"
                        >
                          profil <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium flex items-center gap-2">
                          {p.firma}
                          {p.kampanya && p.kampanya !== 'MUSTERI' && (
                            <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] uppercase tracking-wide">{KAMPANYA_LABEL[p.kampanya] ?? p.kampanya}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{p.unvan || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {p.sektor ? (SEKTOR_LABEL[p.sektor] ?? p.sektor) : '—'}
                        {p.kademe ? <span className="ml-1 px-1.5 py-0.5 rounded bg-muted text-[10px]">K{p.kademe}</span> : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={meta.variant} className={cn('whitespace-nowrap', meta.cls)}>{meta.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {tarihler.length === 0 ? '—' : tarihler.map(([k, d]) => (
                          <div key={k}><span className="inline-block w-10 opacity-70">{k}</span>{fmtDate(d)}</div>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-xs text-rose-600 dark:text-rose-400 max-w-[220px]">
                        {p.lastError ? <span className="line-clamp-2" title={p.lastError}>{p.lastError}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs max-w-[260px]">
                        {/* NEDEN: gercek tick oncesi DM'nin kimlik + "istemezseniz bir daha yazmayacagim" cumlesini tasidigi panelden dogrulanabilmeli */}
                        {metinVar ? (
                          <button type="button" className="inline-flex items-center gap-1 text-orange-600 hover:underline" onClick={() => setAcik(acikMi ? null : p.id)}>
                            <MessageSquareText className="h-3 w-3" /> {acikMi ? 'gizle' : 'göster'}
                          </button>
                        ) : <span className="text-muted-foreground">—</span>}
                        {acikMi && (
                          <div className="mt-2 space-y-2 text-muted-foreground">
                            {p.noteText && <div><div className="font-medium text-foreground">Bağlantı notu ({p.noteText.length}/300)</div><div className="whitespace-pre-wrap">{p.noteText}</div></div>}
                            {p.messageText && <div><div className="font-medium text-foreground">Mesaj</div><div className="whitespace-pre-wrap">{p.messageText}</div></div>}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground max-w-[180px]">
                        {p.screenshotPath ? (
                          <span className="inline-flex items-center gap-1 truncate" title={p.screenshotPath}>
                            <Camera className="h-3 w-3 shrink-0" />
                            <span className="truncate">{p.screenshotPath.split('/').pop()}</span>
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => skip(p)}
                          disabled={skipDisabled || !!busy}
                          title="Kuyruktan çıkar; bot bu kişiye bir daha yazmaz"
                        >
                          <SkipForward className="h-3.5 w-3.5 mr-1" />
                          Atla
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  YARDIMCI BILESENLER
// ═══════════════════════════════════════════════════════════════

function Counter({ label, value, limit }: { label: string; value: number; limit?: number }) {
  const dolu = limit !== undefined && value >= limit;
  const yakin = limit !== undefined && !dolu && value >= limit * 0.8;
  return (
    <Card className={cn('border', dolu && 'border-rose-500/40 bg-rose-500/5', yakin && 'border-amber-500/40 bg-amber-500/5')}>
      <CardContent className="p-4">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="text-3xl font-semibold mt-2 tabular-nums">
          {value}
          {limit !== undefined && <span className="text-base font-normal text-muted-foreground">/{limit}</span>}
        </div>
        {limit !== undefined && (
          <div className="text-[11px] text-muted-foreground mt-1">{dolu ? 'limit doldu' : `${limit - value} kaldı`}</div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * LinkedIn arama linkleriyle tarama. Kullanici LinkedIn'de kendi filtresini kurar
 * (unvan, konum, sirket, baglanti derecesi), linki buraya yapistirir; bot sayfayi
 * gezip hedef unvanli kisileri kuyruga yazar. GONDERIM YOK — yalniz kuyruk.
 */
function SearchUrlCard({ onDone, disabled }: { onDone: () => Promise<void>; disabled: boolean }) {
  const [text, setText] = useState('');
  const [kampanya, setKampanya] = useState<LinkedinKampanya>('MUSTERI');
  const [sayfa, setSayfa] = useState(5);
  const [sending, setSending] = useState(false);
  const linkSayisi = useMemo(
    () => text.split(/[\n,;]+/).map((t) => t.trim()).filter((t) => /linkedin\.com\/search\/results\/people/i.test(t)).length,
    [text],
  );

  const submit = async () => {
    if (linkSayisi === 0) return;
    setSending(true);
    try {
      const res = await api.researchLinkedinUrls({ urls: text, kampanya, sayfa });
      if (!res?.started) {
        toast.error(res?.reason ?? 'Tarama başlatılamadı');
        return;
      }
      toast.success(`${res.urls} link × ${sayfa} sayfa taranıyor — sonuçlar aşağıdaki listeye düşecek`);
      if (res.gecersiz?.length) toast.warning(`${res.gecersiz.length} satır anlaşılmadı (kişi arama linki değil)`);
      setText('');
      setTimeout(() => { void onDone(); }, 4000);
    } catch (err: any) {
      toast.error(`Tarama başlatılamadı: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Arama linkleriyle tara
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              LinkedIn&apos;de aramanı yap (ünvan, konum, şirket filtreleri), adres çubuğundaki linki buraya yapıştır — her satıra bir link.
              Bot sayfayı gezip <span className="font-medium">hedef ünvanlı</span> kişileri kuyruğa yazar; <span className="font-medium">mesaj göndermez</span>.
            </div>
          </div>
          <Button size="sm" onClick={submit} disabled={disabled || sending || linkSayisi === 0}>
            {sending ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Search className="h-3.5 w-3.5 mr-1.5" />}
            Taramayı başlat{linkSayisi > 0 ? ` (${linkSayisi})` : ''}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Kampanya:</span>
          {KAMPANYA.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKampanya(k.key)}
              title={k.aciklama}
              className={cn('px-2.5 py-1.5 rounded-md border text-xs transition-colors', kampanya === k.key ? 'bg-orange-500 text-white border-orange-500' : 'hover:bg-muted')}
            >
              {k.label}
            </button>
          ))}
          <span className="text-xs text-muted-foreground">{KAMPANYA.find((k) => k.key === kampanya)?.aciklama}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Kaç sonuç sayfası:</span>
          {[1, 3, 5, 10].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setSayfa(n)}
              className={cn('px-2.5 py-1.5 rounded-md border text-xs transition-colors', sayfa === n ? 'bg-orange-500 text-white border-orange-500' : 'hover:bg-muted')}
            >
              {n} sayfa
            </button>
          ))}
          <span className="text-xs text-muted-foreground">≈ {sayfa * 10} kişi taranır · her sayfa ~1 dk</span>
        </div>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={'https://www.linkedin.com/search/results/people/?keywords=CEO&origin=SWITCH_SEARCH_VERTICAL\nhttps://www.linkedin.com/search/results/people/?keywords=CMO'}
          className="font-mono text-xs"
        />
        <div className="text-xs text-muted-foreground">
          Firma bilgisi kartın &quot;Mevcut: … şirketinde …&quot; satırından ya da başlıktan (&quot;CTO at X&quot;, &quot;CTO - X&quot;) okunur; firması okunamayan kişi kaydedilmez.
          Tek seferde en fazla 12 link × 10 sayfa.
        </div>
      </CardContent>
    </Card>
  );
}

function ImportCard({ onDone, disabled }: { onDone: () => Promise<void>; disabled: boolean }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const parsed = useMemo(() => parseImportText(text), [text]);

  const submit = async () => {
    if (parsed.rows.length === 0) return;
    setSending(true);
    try {
      const res = await api.importLinkedinProspects(parsed.rows);
      toast.success(`${res?.upserted ?? parsed.rows.length} kayıt eklendi/güncellendi`);
      setText('');
      await onDone();
    } catch (err: any) {
      toast.error(`İçe aktarılamadı: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              <Upload className="h-4 w-4" />
              CSV içe aktar
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Sütunlar: <span className="font-mono">ad,soyad,firma,unvan,sektor,kademe,profileUrl</span> — başlık satırı isteğe bağlı,
              ayırıcı virgül/noktalı virgül/sekme. Profil URL&apos;si kanonik hale getirilir (www, dil alt alanı, ?trk, büyük harf farkı kopya oluşturmaz).
            </div>
          </div>
          <Button size="sm" onClick={submit} disabled={disabled || sending || parsed.rows.length === 0}>
            {sending ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
            İçe aktar{parsed.rows.length > 0 ? ` (${parsed.rows.length})` : ''}
          </Button>
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={'Ayşe,Yılmaz,Örnek Bank,Dijital Pazarlama Direktörü,finans,1,https://www.linkedin.com/in/ayse-yilmaz'}
          className="font-mono text-xs"
        />
        {text.trim() && (
          <div className="text-xs flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-emerald-600 dark:text-emerald-400">{parsed.rows.length} geçerli satır</span>
            {parsed.hatalar.length > 0 && (
              <span className="text-rose-600 dark:text-rose-400">{parsed.hatalar.length} sorunlu satır</span>
            )}
          </div>
        )}
        {parsed.hatalar.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
            {parsed.hatalar.slice(0, 8).map((h, i) => <li key={i}>• {h}</li>)}
            {parsed.hatalar.length > 8 && <li>… ve {parsed.hatalar.length - 8} satır daha</li>}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
