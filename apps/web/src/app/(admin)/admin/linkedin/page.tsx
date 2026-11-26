'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  api,
  type LinkedinKampanya,
  type LinkedinSatisAsamasi,
  type LinkedinOverview,
  type LinkedinProspect,
  type LinkedinProspectStatus,
  type IletisimKanal,
} from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { KonusmaDialog } from './konusma-dialog';
import { ClaudeGonderimCard } from './claude-gonderim';
import { konusmaBalonlari, konusmaOzeti } from '@/lib/konusma';
import { cn } from '@/lib/utils';
import {
  IMPORT_BATCH_MAX_ROWS, IMPORT_MAX_ROWS_PER_RUN, importRunNotice, parseImportText, planImportBatches, remainingImportText, runImportBatches,
} from '@/lib/linkedin-import';
import {
  Users, RefreshCw, Pause, Play, Send, Upload,
  AlertTriangle, SkipForward, Camera, ExternalLink, MessageSquareText, Link2, Search, Clock,
  FileBarChart, CalendarClock, Mail, PenLine, Reply,
} from 'lucide-react';

/** Cevap sonrasi satis hunisi — insan elle ilerletir (bot dokunmaz) */
const SATIS_ASAMALARI: Array<{ key: LinkedinSatisAsamasi; label: string }> = [
  { key: 'YOK', label: '—' },
  { key: 'GORUSULDU', label: 'Görüşüldü' },
  { key: 'KARNE_GONDERILDI', label: 'Karne gönderildi' },
  { key: 'TOPLANTI', label: 'Toplantı' },
  { key: 'TEKLIF', label: 'Teklif' },
  { key: 'KAZANILDI', label: 'Kazanıldı' },
  { key: 'KAYBEDILDI', label: 'Kaybedildi' },
];

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

// CSV ayristirma ve partili gonderim: lib/linkedin-import.ts (saf, test edilir)

// ═══════════════════════════════════════════════════════════════
//  SAYFA
// ═══════════════════════════════════════════════════════════════


export default function AdminLinkedinPage() {
  const [overview, setOverview] = useState<LinkedinOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // Sohbet penceresinde acik kayit (id; veri her yenilemede listeden taze okunur)
  const [konusmaId, setKonusmaId] = useState<string | null>(null);
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

  const cevapGeldi = (p: LinkedinProspect) => run(`cevap:${p.id}`, async () => {
    const r = await api.cevapGeldiLinkedin(p.id);
    if (r.ok) toast.success(`${p.ad} ${p.soyad}: cevap verdi olarak işaretlendi`);
    else toast.error('Bu kayıt işaretlenemedi (zaten cevaplı ya da atlanmış olabilir)');
    await load();
  });

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

  const enabled = overview?.enabled ?? true;

  /** Gonderimi ac/kapat — dis dunyaya cikan eylem, onay ister */
  /**
   * Bu aday için ücretsiz karne üret. Host panelden sorulur: kayıtta alan adı yok
   * (LinkedIn araştırması firma adı verir, alan adı vermez).
   */
  const karneUret = async (p: LinkedinProspect) => {
    const host = window.prompt(`${p.firma} için kurum alan adı (örn. papara.com):`, '');
    if (!host?.trim()) return;
    const sektor = p.sektor?.trim() || window.prompt('Sektör (finans | eticaret-perakende-teknoloji | turizm-havayolu-telekom-otomotiv):', 'finans') || '';
    if (!sektor.trim()) return;
    setBusy(`karne:${p.id}`);
    try {
      const res = await api.uretLinkedinKarne(p.id, { host: host.trim(), sektor: sektor.trim() });
      if (!res?.started) {
        toast.error(res?.reason ?? 'Karne başlatılamadı');
        return;
      }
      toast.success(res.reason ?? 'Karne üretiliyor — bitince bildirim gelecek');
    } catch (err: any) {
      toast.error(`Karne üretilemedi: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  /** Eski botu kapat (acma dugmesi yok: bozuk bot kisileri hatali isaretleyip kuyruktan dusuruyordu) */
  const eskiBotuKapat = async () => {
    setBusy('enabled');
    try {
      await api.setLinkedinEnabled(false);
      toast.success('Eski bot kapatıldı — gönderim yalnız Claude ile');
      await load();
    } catch (err: any) {
      toast.error(`Kapatılamadı: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };
  const claudeKartinaGit = () => {
    document.getElementById('claude-gonderim')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
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
          <h1 className="text-2xl font-[450] tracking-[-0.04em] flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            LinkedIn Outreach
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Kurucu hesabından sıkı frenli bağlantı isteği. Listeyi ve notları sen onaylarsın, istekleri senin Mac&apos;inde
            Claude gönderir; cevap gelince konuşmayı sen sürdürürsün.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button size="sm" variant="outline" onClick={() => load()} disabled={!!busy}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Yenile
          </Button>
          {/* Gonderim artik yalniz Claude ile (26.11): eski botun tick/duraklat dugmeleri kaldirildi */}
          <Button size="sm" onClick={claudeKartinaGit}>
            <Send className="h-3.5 w-3.5 mr-1.5" />
            Claude ile gönder
          </Button>
        </div>
      </div>

      {/* ── Uyarı ── */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <span className="font-medium">LinkedIn otomasyonu kullanım koşullarına aykırıdır; hesap kısıtlanabilir.</span>{' '}
          Günde ≤{limit.dayRequests} istek, ≤{limit.dayMessages} mesaj; haftada ≤{limit.weekRequests} istek. Limit/captcha/giriş duvarı
          görülürse Claude durur. DM de ticari elektronik ileti sayılabilir — İYS/KVKK rejimi e-posta listesiyle aynıdır.
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
            <div className="text-3xl font-[450] tracking-[-0.04em] mt-2 tabular-nums">
              {acceptPct === null ? '—' : `%${acceptPct.toFixed(0)}`}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {acceptPct === null
                ? `henüz örnek yok${base ? ` (${base.requests}/${base.minRequests} olgun istek)` : ''}`
                : `${base ? `${base.accepted}/${base.requests} · ` : ''}%${ACCEPT_RATE_FLOOR_PCT} altı → oto-duraklama`}
            </div>
          </CardContent>
        </Card>
        <Card className={cn('border md:col-span-1', enabled ? 'border-rose-500/40 bg-rose-500/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Gönderim</div>
            {enabled ? (
              <>
                {/* Eski bot (OpenClaw) bozuk: aciksa kisileri hatali isaretleyip kuyruktan dusurur */}
                <div className="text-xl font-[450] tracking-[-0.04em] mt-2 flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-4 w-4" /> Eski bot açık
                </div>
                <div className="text-xs text-muted-foreground mt-1">Eski bot çalışmıyor ve kişileri kuyruktan düşürebilir. Kapat, gönderimi Claude ile yap.</div>
                <Button size="sm" variant="destructive" className="mt-3 w-full" onClick={eskiBotuKapat} disabled={!!busy}>
                  {busy === 'enabled' ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Pause className="h-3.5 w-3.5 mr-1.5" />}
                  Eski botu kapat
                </Button>
              </>
            ) : (
              <>
                <div className="text-xl font-[450] tracking-[-0.04em] mt-2 flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <Send className="h-4 w-4" /> Claude ile
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Son başarılı istek: <span className="text-foreground">{overview?.sonBasariliIstek ? new Date(overview.sonBasariliIstek).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'hiç'}</span>
                </div>
                <Button size="sm" className="mt-3 w-full" onClick={claudeKartinaGit}>
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  Yeni tur başlat
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>


      {/* ── Claude ile gönderim (Mac'te, kurucunun Chrome'unda) ── */}
      <div id="claude-gonderim" className="scroll-mt-4">
        <ClaudeGonderimCard onDone={load} />
      </div>

      {/* ── Bugün ilgilenilecekler ── */}
      <TakipCard overview={overview ?? undefined} onDone={load} disabled={!!busy} onKonusma={setKonusmaId} />

      {/* ── Elle kayıt: kendi attığın LinkedIn / e-posta mesajı ── */}
      <ElleKayitCard onDone={load} disabled={!!busy} />

      {/* ── Çalışma ayarları ── */}
      <AyarCard overview={overview ?? undefined} onDone={load} disabled={!!busy} />

      {/* ── Mesaj şablonları ── */}
      <SablonCard sablonlar={overview?.sablonlar} />

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
                className={cn('px-2.5 py-1.5 rounded-md border text-xs transition-colors', firmaFiltre === 'hepsi' ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}
              >
                Hepsi <span className="opacity-70">({toplamKayit})</span>
              </button>
              {byFirma.map((f) => (
                <button
                  key={f.firma}
                  type="button"
                  onClick={() => setFirmaFiltre(firmaFiltre === f.firma ? 'hepsi' : f.firma)}
                  className={cn('px-2.5 py-1.5 rounded-md border text-xs transition-colors', firmaFiltre === f.firma ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}
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
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
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
                  const ozet = konusmaOzeti(konusmaBalonlari(p));
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium whitespace-nowrap">{p.ad} {p.soyad}</div>
                        <KisiLinki profileUrl={p.profileUrl} kanal={p.kanal} eposta={p.eposta} />
                        {p.elle && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-muted text-label" title="Elle gönderildi; bot bu kişiye yazmaz">elle</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium flex items-center gap-2">
                          {p.firma}
                          {p.kampanya && p.kampanya !== 'MUSTERI' && (
                            <span className="px-1.5 py-0.5 rounded bg-muted text-[10px]">{KAMPANYA_LABEL[p.kampanya] ?? p.kampanya}</span>
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
                        {/* Sohbet penceresi: giden sagda, gelen solda; buradan yeni mesaj/cevap da kaydedilir */}
                        <button type="button" className="inline-flex items-center gap-1 text-brand-600 hover:underline whitespace-nowrap" onClick={() => setKonusmaId(p.id)}>
                          <MessageSquareText className="h-3 w-3" /> {ozet === '—' ? 'Konuşma' : ozet}
                        </button>
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
                        {/* Elle ve e-posta kayitlarinda cevap kontrolu insanda: tek tikla "Cevap verdi" */}
                        {p.status === 'MESSAGED' && (p.elle || p.kanal === 'EPOSTA') && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-2"
                            onClick={() => cevapGeldi(p)}
                            disabled={!!busy}
                            title="Bu kişi cevap verdi — hatırlatma kalkar, kişi 'Bugün ilgilenilecekler'e düşer"
                          >
                            <Reply className="h-3.5 w-3.5 mr-1" />
                            Cevap geldi
                          </Button>
                        )}
                        {/* Cevap gelmis kayitta ucretsiz karne — satisin acilis hamlesi */}
                        {(p.status === 'REPLIED' || p.status === 'MESSAGED' || p.status === 'ACCEPTED') && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-2"
                            onClick={() => karneUret(p)}
                            disabled={!!busy}
                            title="Bu kurum için ücretsiz AI görünürlük karnesi üret (paylaşılabilir link)"
                          >
                            {busy === `karne:${p.id}` ? (
                              <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <FileBarChart className="h-3.5 w-3.5 mr-1" />
                            )}
                            Karne
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <KonusmaDialog
        p={konusmaId ? recentAll.find((r) => r.id === konusmaId) ?? null : null}
        onClose={() => setKonusmaId(null)}
        onDone={() => load(true)}
      />
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
        <div className="text-3xl font-[450] tracking-[-0.04em] mt-2 tabular-nums">
          {value}
          {limit !== undefined && <span className="text-base font-normal text-muted-foreground">/{limit}</span>}
        </div>
        {limit !== undefined && (
          <div className="text-xs text-muted-foreground mt-1">{dolu ? 'limit doldu' : `${limit - value} kaldı`}</div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Cevap verip beklemede kalanlar + hatirlatmasi gelenler. NEDEN ayri kart: cevap geldiginde
 * bot susuyor ve is insana geciyor; bu liste olmadan cevaplar 148 satirlik tablonun icinde kayboluyordu.
 */
function TakipCard({ overview, onDone, disabled, onKonusma }: { overview?: LinkedinOverview; onDone: () => Promise<void>; disabled: boolean; onKonusma: (id: string) => void }) {
  const liste = overview?.ilgilenilecek ?? [];
  const [calisan, setCalisan] = useState<string | null>(null);
  if (liste.length === 0) return null;

  const asamaYaz = async (id: string, asama: LinkedinSatisAsamasi) => {
    setCalisan(id);
    try {
      await api.setLinkedinSatis(id, { asama });
      toast.success('Aşama güncellendi');
      await onDone();
    } catch (err: any) {
      toast.error(`Güncellenemedi: ${err.message}`);
    } finally {
      setCalisan(null);
    }
  };

  return (
    <Card className="border-emerald-500/40 bg-emerald-500/5">
      <CardContent className="p-4 space-y-3">
        <div className="text-sm font-medium flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />
          Bugün ilgilenilecekler <span className="text-muted-foreground font-normal">({liste.length})</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Cevap verip beklemede kalanlar ve hatırlatma tarihi gelenler. Bot bu kişilere bir daha yazmaz — konuşmayı sen sürdürürsün.
        </div>
        <div className="space-y-2">
          {liste.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2.5">
              <div className="min-w-[190px] flex-1">
                <div className="text-sm font-medium">{k.ad} {k.soyad}</div>
                <div className="text-xs text-muted-foreground">{k.firma}{k.unvan ? ` · ${k.unvan}` : ''}</div>
              </div>
              <KisiLinki profileUrl={k.profileUrl} kanal={k.kanal} eposta={k.eposta} />
              <button type="button" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1" onClick={() => onKonusma(k.id)}>
                <MessageSquareText className="h-3 w-3" /> konuşma
              </button>
              {k.hatirlatmaAt && (
                <span className="text-xs text-muted-foreground">hatırlatma: {fmtDate(k.hatirlatmaAt)}</span>
              )}
              <select
                value={k.satisAsamasi ?? 'YOK'}
                onChange={(e) => asamaYaz(k.id, e.target.value as LinkedinSatisAsamasi)}
                disabled={disabled || calisan === k.id}
                className="h-8 rounded-md border bg-background px-2 text-xs"
                aria-label="Satış aşaması"
              >
                {SATIS_ASAMALARI.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const GUN_ADI = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

/** Panelden degistirilebilen ayarlar: etiket, aciklama, alan adi */
const AYAR_ALANLARI: Array<{ key: string; label: string; ipucu: string }> = [
  { key: 'MAX_REQUESTS_PER_DAY', label: 'Günlük bağlantı isteği', ipucu: 'Bir günde gönderilecek en fazla bağlantı isteği' },
  { key: 'MAX_MESSAGES_PER_DAY', label: 'Günlük mesaj', ipucu: 'Kabul edenlere bir günde gönderilecek en fazla mesaj' },
  { key: 'MAX_REQUESTS_PER_WEEK', label: 'Haftalık istek', ipucu: 'LinkedIn haftalık davet sınırı için üst güvenlik freni' },
  { key: 'MAX_ACTIONS_PER_TICK', label: 'Tur başına işlem', ipucu: '0 = öldürme anahtarı: bot hiçbir işlem yapmaz' },
  { key: 'SAME_COMPANY_PER_DAY', label: 'Aynı firmadan / gün', ipucu: 'Bir firmadan günde en fazla kaç kişiye yazılsın' },
  { key: 'MAX_RESEARCH_PER_DAY', label: 'Günlük tarama', ipucu: 'Arama sayfası tarama sayısı (gönderim değil)' },
  { key: 'MAX_INMAILS_PER_DAY', label: 'Günlük InMail', ipucu: 'Premium ile bağlantı beklemeden gönderilen doğrudan mesaj (kredi harcar)' },
];

/** İletişim yöntemleri */
const MODLAR: Array<{ key: 'baglanti' | 'inmail' | 'karma'; label: string; aciklama: string }> = [
  { key: 'baglanti', label: 'Bağlantı isteği', aciklama: 'Önce notlu bağlantı isteği; kabul ederse mesaj. Kredi harcamaz, kabul beklenir.' },
  { key: 'inmail', label: 'Doğrudan mesaj (Premium)', aciklama: 'Bağlantı beklemeden InMail gönderir — Premium kredisi harcar, cevap çok daha hızlı gelir.' },
  { key: 'karma', label: 'Önce InMail, sonra bağlantı', aciklama: 'Günlük InMail kotası dolunca kalan kişilere bağlantı isteği gönderir.' },
];

/**
 * Calisma saati ve fren ayarlari — panelden. NEDEN: kullanici saatleri ve limitleri
 * sunucuya girmeden degistirmek istiyor (30.08). Degerler guvenlik tavanlarina kirpilir;
 * tavanlar arka uctan (ayarTavan) gelir, panel kendi kopyasini tasimaz.
 */
function AyarCard({ overview, onDone, disabled }: { overview?: LinkedinOverview; onDone: () => Promise<void>; disabled: boolean }) {
  const L = (overview?.limits ?? {}) as Record<string, number | number[]>;
  const tavan = overview?.ayarTavan ?? {};
  const [taslak, setTaslak] = useState<Record<string, number> | null>(null);
  const [gunler, setGunler] = useState<number[] | null>(null);
  const [taslakMod, setTaslakMod] = useState<'baglanti' | 'inmail' | 'karma' | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const deger = (k: string): number => (taslak?.[k] ?? (typeof L[k] === 'number' ? (L[k] as number) : 0));
  const aktifGunler = gunler ?? (Array.isArray(L.WORK_DAYS) ? (L.WORK_DAYS as number[]) : [1, 2, 3, 4, 5]);
  const degisti = taslak !== null || gunler !== null || (taslakMod !== null && taslakMod !== overview?.mod);

  const kaydet = async () => {
    setKaydediliyor(true);
    try {
      const govde: Record<string, number | number[] | string> = { ...(taslak ?? {}), WORK_DAYS: aktifGunler };
      for (const k of ['WORK_HOUR_START', 'WORK_HOUR_END']) if (govde[k] === undefined) govde[k] = deger(k);
      if (taslakMod) govde.MOD = taslakMod;
      await api.setLinkedinAyarlar(govde);
      toast.success('Ayarlar kaydedildi — sonraki turdan itibaren geçerli');
      setTaslak(null);
      setGunler(null);
      setTaslakMod(null);
      await onDone();
    } catch (err: any) {
      toast.error(`Kaydedilemedi: ${err.message}`);
    } finally {
      setKaydediliyor(false);
    }
  };

  const setDeger = (k: string, v: number) => setTaslak((t) => ({ ...(t ?? {}), [k]: v }));

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Çalışma ayarları
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Saat ve limitler burada; kaydettiğinde sunucuya girmeye gerek yok. Değerler güvenlik aralığına kırpılır
              (hesap kısıtlanmasın diye üst sınırlar var).
            </div>
          </div>
          <Button size="sm" onClick={kaydet} disabled={disabled || kaydediliyor || !degisti}>
            {kaydediliyor ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
            Kaydet
          </Button>
        </div>

        {/* İletişim modu */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="text-xs font-medium">İletişim yöntemi</div>
          <div className="flex flex-wrap gap-2">
            {MODLAR.map((m) => {
              const secili = (taslakMod ?? overview?.mod ?? 'baglanti') === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setTaslakMod(m.key)}
                  className={cn('px-2.5 py-1.5 rounded-md border text-xs transition-colors', secili ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}
                  title={m.aciklama}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            {MODLAR.find((m) => m.key === (taslakMod ?? overview?.mod ?? 'baglanti'))?.aciklama}
            {typeof overview?.inmailKredi === 'number' && (
              <> · Kalan InMail kredisi: <span className="font-medium text-foreground">{overview.inmailKredi}</span></>
            )}
          </div>
        </div>

        {/* Çalışma penceresi */}
        <div className="rounded-md border p-3 space-y-3">
          <div className="text-xs font-medium">Çalışma penceresi (Europe/Istanbul)</div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              Başlangıç
              <select
                value={deger('WORK_HOUR_START')}
                onChange={(e) => setDeger('WORK_HOUR_START', Number(e.target.value))}
                className="h-8 rounded-md border bg-background px-2 text-xs tabular-nums"
              >
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              Bitiş
              <select
                value={deger('WORK_HOUR_END')}
                onChange={(e) => setDeger('WORK_HOUR_END', Number(e.target.value))}
                className="h-8 rounded-md border bg-background px-2 text-xs tabular-nums"
              >
                {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground mr-1">Günler:</span>
              {GUN_ADI.map((ad, i) => {
                const secili = aktifGunler.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      const yeni = secili ? aktifGunler.filter((d) => d !== i) : [...aktifGunler, i].sort();
                      setGunler(yeni.length ? yeni : aktifGunler);
                    }}
                    className={cn('px-2 py-1 rounded border text-xs transition-colors', secili ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}
                  >
                    {ad}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Bot yalnız seçili gün ve saatlerde bağlantı isteği/mesaj gönderir; tarama (arama linki) bu pencereye bakmaz.
          </div>
        </div>

        {/* Frenler */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AYAR_ALANLARI.map((a) => {
            const t = tavan[a.key];
            return (
              <label key={a.key} className="rounded-md border p-3 space-y-1.5 block">
                <div className="text-xs font-medium">{a.label}</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={deger(a.key)}
                    min={t?.min ?? 0}
                    max={t?.max ?? 999}
                    onChange={(e) => setDeger(a.key, Number(e.target.value))}
                    className="h-8 w-20 rounded-md border bg-background px-2 text-xs tabular-nums"
                  />
                  {t ? <span className="text-xs text-muted-foreground">{t.min}–{t.max} arası</span> : null}
                </div>
                <div className="text-xs text-muted-foreground">{a.ipucu}</div>
              </label>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Kampanya mesaj sablonlari — LinkedIn gorunumunde. NEDEN ayri kart: kullanici gonderilecek
 * metni secim aninda ve bir bakista gormek istiyor (30.08 "panelden gorelim mesajlari").
 * Metinler arka uctan gelir (overview.sablonlar) — panel kendi kopyasini tasimaz, sapma olmaz.
 */
function SablonCard({ sablonlar }: { sablonlar?: LinkedinOverview['sablonlar'] }) {
  const [secili, setSecili] = useState<LinkedinKampanya>('MUSTERI');
  const [kopyalanan, setKopyalanan] = useState<string | null>(null);
  const aktif = sablonlar?.find((x) => x.kampanya === secili);

  const kopyala = async (metin: string, etiket: string) => {
    try {
      await navigator.clipboard.writeText(metin);
      setKopyalanan(etiket);
      setTimeout(() => setKopyalanan(null), 1500);
    } catch {
      toast.error('Kopyalanamadı');
    }
  };

  /** Kisiye gore degisen parcalari (ad, firma) vurgula */
  const vurgula = (metin: string, ornek?: { kisi: string; firma: string }) => {
    const parcalar = [ornek?.kisi, ornek?.firma].filter((x): x is string => !!x && x.length > 1);
    if (parcalar.length === 0) return metin;
    const kalip = new RegExp(`(${parcalar.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
    return metin.split(kalip).map((par, i) =>
      parcalar.includes(par)
        ? <mark key={i} className="bg-brand-500/15 text-brand-700 dark:text-brand-300 rounded px-0.5">{par}</mark>
        : <span key={i}>{par}</span>,
    );
  };

  if (!sablonlar?.length) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              <MessageSquareText className="h-4 w-4" />
              Mesaj şablonları
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Kişiye önce <span className="font-medium">bağlantı isteği notu</span> gider; kabul ederse{' '}
              <span className="font-medium">mesaj</span> gönderilir.
              {aktif?.ornek ? (
                <> Önizleme kuyruktaki kişiyle: <span className="font-medium text-foreground">{aktif.ornek.kisi} / {aktif.ornek.firma}</span> —{' '}
                  <span className="bg-brand-500/15 text-brand-700 dark:text-brand-300 px-1 rounded">turuncu</span> kısımlar her kişide değişir.
                </>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {sablonlar.map((s) => (
              <button
                key={s.kampanya}
                type="button"
                onClick={() => setSecili(s.kampanya)}
                className={cn('px-2.5 py-1.5 rounded-md border text-xs transition-colors', secili === s.kampanya ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}
              >
                {s.ad}
              </button>
            ))}
          </div>
        </div>

        {aktif && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {/* 1) Bağlantı isteği notu */}
            <div className="rounded-lg border bg-muted/20 overflow-hidden">
              <div className="px-3 py-2 border-b bg-muted/40 flex items-center justify-between gap-2">
                <div className="text-xs font-medium">1. Bağlantı isteği notu</div>
                <div className="flex items-center gap-2">
                  <span className={cn('text-xs tabular-nums', aktif.notUzunluk > aktif.notSinir ? 'text-rose-600' : 'text-muted-foreground')}>
                    {aktif.notUzunluk}/{aktif.notSinir}
                  </span>
                  <button type="button" onClick={() => kopyala(aktif.not, 'not')} className="text-xs text-brand-600 hover:underline">
                    {kopyalanan === 'not' ? 'kopyalandı' : 'kopyala'}
                  </button>
                </div>
              </div>
              <div className="p-3">
                <div className="flex gap-2">
                  <div className="h-7 w-7 rounded-full bg-brand-500/15 text-brand-600 grid place-items-center text-xs font-semibold shrink-0">RU</div>
                  <div className="rounded-lg rounded-tl-sm bg-background border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">
                    {vurgula(aktif.not, aktif.ornek)}
                  </div>
                </div>
              </div>
            </div>

            {/* 2) InMail ya da kabul sonrası mesaj */}
            <div className="rounded-lg border bg-muted/20 overflow-hidden">
              <div className="px-3 py-2 border-b bg-muted/40 flex items-center justify-between gap-2">
                <div className="text-xs font-medium">2. Kabul edince gönderilen mesaj</div>
                <button type="button" onClick={() => kopyala(aktif.mesaj, 'mesaj')} className="text-xs text-brand-600 hover:underline">
                  {kopyalanan === 'mesaj' ? 'kopyalandı' : 'kopyala'}
                </button>
              </div>
              <div className="p-3">
                <div className="flex gap-2">
                  <div className="h-7 w-7 rounded-full bg-brand-500/15 text-brand-600 grid place-items-center text-xs font-semibold shrink-0">RU</div>
                  <div className="rounded-lg rounded-tl-sm bg-background border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">
                    {vurgula(aktif.mesaj, aktif.ornek)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          Her kişiye kendi adı ve firması yazılır (yukarıdaki turuncu kısımlar). Metinler{' '}
          <span className="font-mono">apps/api/src/intel/linkedin-outreach-rules.ts</span> içinde; değiştirmek istersen söyle.
          Üçü de kimlik açıklar ve &quot;istemezseniz bir daha yazmayacağım&quot; ile biter (6563 md. 8/3 ret hakkı).
        </div>
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
              className={cn('px-2.5 py-1.5 rounded-md border text-xs transition-colors', kampanya === k.key ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}
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
              className={cn('px-2.5 py-1.5 rounded-md border text-xs transition-colors', sayfa === n ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}
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
  // Partili gonderimde ilerleme (tamamlanan / toplam parti)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const parsed = useMemo(() => parseImportText(text), [text]);
  // Dosyadan yukleme (26.11): tablo programindan kopyalayip yapistirmak sutunlari kaydirabiliyordu
  const dosyaRef = useRef<HTMLInputElement>(null);
  const [dosyaAdi, setDosyaAdi] = useState<string | null>(null);
  const dosyaOku = async (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > 2_000_000) { toast.error('Dosya çok büyük (en fazla 2 MB)'); return; }
    if (/\.(xlsx?|numbers)$/i.test(f.name)) { toast.error('Excel / Numbers dosyası okunamaz — CSV olarak dışa aktarıp onu seç'); return; }
    try {
      // BOM (Excel "CSV UTF-8" disa aktarimi) basliktaki ilk sutunu bozmasin
      const metin = (await f.text()).replace(/^\uFEFF/, '');
      setText(metin);
      setDosyaAdi(f.name);
    } catch {
      toast.error('Dosya okunamadı');
    }
  };
  const gonderilecek = parsed.rows.length > IMPORT_MAX_ROWS_PER_RUN ? IMPORT_MAX_ROWS_PER_RUN : parsed.rows.length;
  const partiSayisi = useMemo(() => planImportBatches(parsed.rows.slice(0, IMPORT_MAX_ROWS_PER_RUN)).length, [parsed.rows]);

  /**
   * Satirlar en fazla 400'luk partiler halinde SIRAYLA gider (lib/linkedin-import.ts).
   * NEDEN: tek istek 100 KB govde sinirina ~575 satirda takiliyor, ice aktarma tumden 413
   * aliyordu. Bir parti hata verirse durulur. Metin kutusundan YALNIZ aktarilan satirlar
   * cikar; baslik, sorunlu ve gonderilmeyen satirlar kalir (remainingImportText). Eskiden kutu
   * yalniz gonderilmeyen gecerli satirlarla yeniden yaziliyor, baslik ve sorunlu satirlar
   * sessizce siliniyordu (S17 yan etkisi). Kutu gonderim boyunca kilitli; metin yine de
   * degistiyse dokunulmaz (sunucu profileUrl ile upsert eder: yeniden deneme kopya uretmez).
   */
  const submit = async () => {
    if (parsed.rows.length === 0) return;
    // Gonderim anindaki metin ve ayristirmasi: kalan metin bunlardan hesaplanir
    const gonderilenMetin = text;
    const p = parsed;
    const rows = p.rows.slice(0, IMPORT_MAX_ROWS_PER_RUN);
    setSending(true);
    setProgress(null);
    try {
      const res = await runImportBatches({
        rows,
        send: (batch) => api.importLinkedinProspects(batch),
        onProgress: (done, total) => setProgress({ done, total }),
      });
      // Gonderilen satirlar tam olarak ilk sentRows gecerli satir (partiler sirali)
      const kalan = remainingImportText(gonderilenMetin, p, res.sentRows);
      setText((cur) => (cur === gonderilenMetin ? kalan.text : cur));
      const n = importRunNotice(res, { leftover: p.rows.length - rows.length, unsent: rows.length - res.sentRows, invalid: kalan.invalidLines });
      if (n.tone === 'error') toast.error(n.title, { description: n.description, duration: 15_000 });
      else if (n.tone === 'warning') toast.warning(n.title, { description: n.description, duration: 15_000 });
      else toast.success(n.title, { description: n.description });
      if (res.sentRows > 0) await onDone();
    } catch (err: any) {
      toast.error(`İçe aktarılamadı: ${err?.message ?? 'beklenmeyen hata'}`);
    } finally {
      setSending(false);
      setProgress(null);
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
              Sütunlar: <span className="font-mono">ad,soyad,firma,unvan,sektor,kademe,profileUrl[,kampanya]</span> — kampanya isteğe bağlı (MUSTERI | YATIRIMCI | ISBIRLIGI); başlık satırı isteğe bağlı,
              ayırıcı virgül/noktalı virgül/sekme. Profil URL&apos;si kanonik hale getirilir (www, dil alt alanı, ?trk, büyük harf farkı kopya oluşturmaz).
              Uzun listeler en fazla {IMPORT_BATCH_MAX_ROWS} satırlık partiler halinde sırayla gönderilir (tek seferde en fazla {IMPORT_MAX_ROWS_PER_RUN.toLocaleString('tr-TR')} satır).
              Aktarılan satırlar metin kutusundan çıkarılır; başlık, sorunlu satırlar ve bir parti hata verirse gönderilmeyen satırlar kutuda kalır, tekrar denemek kopya oluşturmaz.
            </div>
          </div>
          <div className="flex items-center gap-2">
          <input
            ref={dosyaRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            className="hidden"
            onChange={(e) => { void dosyaOku(e.target.files?.[0]); e.target.value = ''; }}
          />
          <Button size="sm" variant="outline" onClick={() => dosyaRef.current?.click()} disabled={disabled || sending}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Dosya seç
          </Button>
          <Button size="sm" onClick={submit} disabled={disabled || sending || parsed.rows.length === 0}>
            {sending ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
            {sending && progress && progress.total > 1
              ? `Gönderiliyor… (${Math.min(progress.done + 1, progress.total)}/${progress.total}. parti)`
              : `İçe aktar${gonderilecek > 0 ? ` (${gonderilecek}${partiSayisi > 1 ? `, ${partiSayisi} parti` : ''})` : ''}`}
          </Button>
          </div>
        </div>
        {dosyaAdi && text.trim() && (
          <div className="text-xs text-muted-foreground">Dosya: <span className="text-foreground">{dosyaAdi}</span> — satırları kontrol edip &quot;İçe aktar&quot;a bas.</div>
        )}
        {/* Gonderim boyunca kilitli: partiler birkac istek surer, arada yazilan kaybolmasin */}
        <Textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setDosyaAdi(null); }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
          onDrop={(e) => { const f = e.dataTransfer.files?.[0]; if (f) { e.preventDefault(); void dosyaOku(f); } }}
          disabled={sending}
          rows={6}
          spellCheck={false}
          placeholder={'Dosyayı buraya sürükle ya da "Dosya seç"e bas. Elle: Ayşe,Yılmaz,Örnek Bank,Dijital Pazarlama Direktörü,finans,1,https://www.linkedin.com/in/ayse-yilmaz'}
          className="font-mono text-xs"
        />
        {text.trim() && (
          <div className="text-xs flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-emerald-600 dark:text-emerald-400">{parsed.rows.length} geçerli satır</span>
            {parsed.hatalar.length > 0 && (
              <span className="text-rose-600 dark:text-rose-400">{parsed.hatalar.length} sorunlu satır</span>
            )}
            {parsed.rows.length > IMPORT_MAX_ROWS_PER_RUN && (
              <span className="text-muted-foreground">
                Bu seferde ilk {IMPORT_MAX_ROWS_PER_RUN.toLocaleString('tr-TR')} satır aktarılır; kalan {parsed.rows.length - IMPORT_MAX_ROWS_PER_RUN} satır metin kutusunda kalır.
              </span>
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

/** LinkedIn kaydinda profil linki, e-posta kaydinda mailto */
function KisiLinki({ profileUrl, kanal, eposta }: { profileUrl: string; kanal?: IletisimKanal; eposta?: string | null }) {
  if (kanal === 'EPOSTA') {
    return (
      <a href={profileUrl} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1" title={eposta ?? undefined}>
        e-posta <Mail className="h-3 w-3" />
      </a>
    );
  }
  return (
    <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
      profil <ExternalLink className="h-3 w-3" />
    </a>
  );
}

const BOS_FORM = {
  kanal: 'LINKEDIN' as IletisimKanal,
  adSoyad: '',
  firma: '',
  unvan: '',
  adres: '',
  konu: '',
  mesaj: '',
  tarih: '',
  hatirlatma: '',
  cevapGeldi: false,
};

/**
 * ELLE KAYIT — kurucunun kendi attigi mesaj (LinkedIn'den elle / Chrome eklentisiyle ya da e-postayla).
 * NEDEN: takip listesi yalniz botun gonderdiklerini tutuyordu; elle gidenler hicbir yerde kayitli
 * degildi (23.11). Bu form GONDERMEZ, yalniz kaydeder. Ayni kisiye ikinci mesaj (hatirlatma) ayni
 * kartin metnine tarihli eklenir. Hatirlatma bos birakilirsa 4 is gunu sonra 10:00.
 */
function ElleKayitCard({ onDone, disabled }: { onDone: () => Promise<void>; disabled: boolean }) {
  const [acik, setAcik] = useState(false);
  const [f, setF] = useState(BOS_FORM);
  const [gonderiyor, setGonderiyor] = useState(false);
  const set = <K extends keyof typeof BOS_FORM>(k: K, v: (typeof BOS_FORM)[K]) => setF((x) => ({ ...x, [k]: v }));
  const eposta = f.kanal === 'EPOSTA';
  const hazir = !!(f.adSoyad.trim() && f.firma.trim() && f.adres.trim() && f.mesaj.trim());

  const kaydet = async () => {
    if (!hazir) return;
    setGonderiyor(true);
    try {
      // datetime-local / date girdisi tarayicinin saat diliminde; ISO'ya cevrilir
      const iso = (v: string) => (v ? new Date(v).toISOString() : null);
      const r = await api.elleKayitLinkedin({
        kanal: f.kanal,
        ad: f.adSoyad.trim(),
        firma: f.firma.trim(),
        unvan: f.unvan.trim() || null,
        profileUrl: eposta ? null : f.adres.trim(),
        eposta: eposta ? f.adres.trim() : null,
        konu: f.konu.trim() || null,
        mesaj: f.mesaj,
        gonderimAt: iso(f.tarih),
        hatirlatmaAt: f.hatirlatma ? new Date(`${f.hatirlatma}T10:00:00`).toISOString() : null,
        cevapGeldi: f.cevapGeldi,
      });
      toast.success(r.yeni ? 'Kayıt eklendi' : 'Bu kişi zaten kayıtlıydı — mesaj kartına eklendi');
      setF({ ...BOS_FORM, kanal: f.kanal });
      await onDone();
    } catch (err: any) {
      toast.error(`Kaydedilemedi: ${err?.message ?? 'beklenmeyen hata'}`);
    } finally {
      setGonderiyor(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              <PenLine className="h-4 w-4" />
              Elle kayıt ekle
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Kendi attığın LinkedIn ya da e-posta mesajını takip listesine ekler — hiçbir şey göndermez.
              Aynı kişiye ikinci mesajı (hatırlatma) eklersen aynı karta tarihiyle yazılır. Hatırlatma boşsa 4 iş günü sonra 10:00.
            </div>
          </div>
          <Button size="sm" variant={acik ? 'ghost' : 'outline'} onClick={() => setAcik(!acik)}>
            {acik ? 'Kapat' : 'Yeni kayıt'}
          </Button>
        </div>
        {acik && (
          <div className="space-y-3">
            <div className="flex gap-2" role="radiogroup" aria-label="Kanal">
              {(['LINKEDIN', 'EPOSTA'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={f.kanal === k}
                  onClick={() => set('kanal', k)}
                  className={cn('px-3 py-1.5 rounded-md border text-xs transition-colors', f.kanal === k ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}
                >
                  {k === 'LINKEDIN' ? 'LinkedIn' : 'E-posta'}
                </button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={f.adSoyad} onChange={(e) => set('adSoyad', e.target.value)} placeholder="Ad Soyad" aria-label="Ad Soyad" />
              <Input value={f.firma} onChange={(e) => set('firma', e.target.value)} placeholder="Firma" aria-label="Firma" />
              <Input
                value={f.adres}
                onChange={(e) => set('adres', e.target.value)}
                placeholder={eposta ? 'E-posta adresi' : 'LinkedIn profil linki (linkedin.com/in/...)'}
                aria-label={eposta ? 'E-posta adresi' : 'LinkedIn profil linki'}
              />
              <Input value={f.unvan} onChange={(e) => set('unvan', e.target.value)} placeholder="Ünvan (isteğe bağlı)" aria-label="Ünvan" />
              {eposta && (
                <Input className="sm:col-span-2" value={f.konu} onChange={(e) => set('konu', e.target.value)} placeholder="E-posta konusu" aria-label="E-posta konusu" />
              )}
            </div>
            <Textarea value={f.mesaj} onChange={(e) => set('mesaj', e.target.value)} rows={5} placeholder="Gönderdiğin mesajın tam metni" aria-label="Mesaj metni" />
            <div className="flex flex-wrap items-end gap-3 text-xs">
              <label className="space-y-1">
                <span className="block text-muted-foreground">Gönderim (boş = şimdi)</span>
                <Input type="datetime-local" value={f.tarih} onChange={(e) => set('tarih', e.target.value)} className="h-8 w-[200px]" />
              </label>
              <label className="space-y-1">
                <span className="block text-muted-foreground">Hatırlatma günü (boş = 4 iş günü)</span>
                <Input type="date" value={f.hatirlatma} onChange={(e) => set('hatirlatma', e.target.value)} className="h-8 w-[170px]" />
              </label>
              <label className="inline-flex items-center gap-2 h-8">
                <input type="checkbox" checked={f.cevapGeldi} onChange={(e) => set('cevapGeldi', e.target.checked)} />
                Cevap da geldi
              </label>
              <Button size="sm" className="ml-auto" onClick={kaydet} disabled={disabled || gonderiyor || !hazir}>
                {gonderiyor ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5 mr-1.5" />}
                Kaydet
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
