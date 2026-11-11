'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { TrendingUp, TrendingDown, Minus, Sparkles, RefreshCw, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BeforeAfterCard } from '@/components/before-after-card';
import { formatTrDate } from '@/components/geo-impact';
import { EngineLogo } from '@/components/engine-logo';
import { PROVIDER_COLORS, PROVIDER_LABELS, PROVIDER_FALLBACK } from '@/lib/chart-colors';
import { CHART } from '@/lib/chart-colors';
import { splitSeriesByMethod } from '@/lib/citation-chart-segments';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_AXIS, CHART_GRID } from '@/components/ui/chart-container';
import { FilterChip } from '@/components/ui/filter-chip';
import { MeasurementLimitNote } from '@/components/measurement-limit-note';
import { displayProbeText, isProbeErrorText, probeErrorText } from '@/lib/probe-error-text';
import { isWeeklyMeasurementLimitError, refreshMeasurementAllowance, useMeasurementAllowance } from '@/lib/measurement-allowance';
import {
  aralikAciklamasi, kararAciklamasi, kararYonu, olcumOf, plusMinus, sorularaGore, tekrarSoruEtiketi,
  type GorunmeAraligi,
} from '@/lib/visibility-interval';

type Ton = 'emerald' | 'amber' | 'slate' | 'red';

/**
 * Tek cevabin (probe) durumu. Markali soru: skor bu probe'lari saymaz — +100/+50
 * rozeti basilirsa kullanici rozetleri toplayip skoru tutturamaz. HATA satiri
 * olcum degildir: "BAHSETMEDI 0" gosterilirse kullanici olculemeyen soruyu sifir
 * puan sanar (skor bu satirlari saymaz).
 */
function probeDurumu(p: any): { label: string; kisa: string; tone: Ton; score: string } {
  if (isProbeErrorText(p?.excerpt)) return { label: 'ÖLÇÜLEMEDİ · SKOR DIŞI', kisa: 'ÖLÇÜLEMEDİ', tone: 'slate', score: '—' };
  if (p?.brandInQuery) return { label: 'MARKALI SORU · SKOR DIŞI', kisa: 'MARKALI', tone: 'slate', score: '—' };
  if (p?.cited) return { label: 'URL ALINTIDI', kisa: 'URL', tone: 'emerald', score: '+100' };
  if (p?.brandMentioned) return { label: 'MARKA GEÇTI', kisa: 'MARKA', tone: 'amber', score: '+50' };
  return { label: 'BAHSETMEDI', kisa: 'YOK', tone: 'red', score: '0' };
}

const TON_SINIF: Record<Ton, { badge: string; bar: string; text: string }> = {
  emerald: { badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  amber: { badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  slate: { badge: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 ring-1 ring-slate-500/30', bar: 'bg-slate-400', text: 'text-muted-foreground' },
  red: { badge: 'bg-red-500/15 text-red-700 dark:text-red-300 ring-1 ring-red-500/30', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
};

/** Grup bar rengi icin: olculen en iyi sonuc (skor disi en altta) */
const TON_SIRA: Record<Ton, number> = { slate: 0, red: 1, amber: 2, emerald: 3 };



/**
 * AI Citation gunluk gorunurluk trendi — provider bazli SVG line chart.
 * 7/30/90/365 gun secimi. Her sayfa yuklenisinde fresh fetch.
 */
export function CitationHistoryChart({
  siteId,
  siteName,
  siteUrl,
}: {
  siteId: string;
  siteName?: string;
  siteUrl?: string;
}) {
  // AI cevap metninde site adı / hostname / URL geçen yeri vurgula.
  // "ai" gibi 3 karakter altı generic terim → false positive yaratır, atlanır.
  const highlightTerms = (() => {
    const terms: string[] = [];
    if (siteName && siteName.trim().length >= 4) terms.push(siteName.trim());
    if (siteUrl) {
      try {
        const u = new URL(siteUrl);
        const h = u.hostname.replace(/^www\./, '');
        if (h) terms.push(h);
        // ranksup.ai → "luvihost" (subdomain çıkar, ana marka kelimesi)
        const parts = h.split('.');
        if (parts.length >= 2) {
          const main = parts[parts.length - 2];
          if (main.length >= 4) terms.push(main);
        }
      } catch { /* ignore bad url */ }
    }
    return Array.from(new Set(terms));
  })();

  // Markdown gürültüsünü temizle + key term'leri <mark> ile sar
  const renderExcerpt = (raw: string) => {
    if (!raw) return null;
    // ## başlık, ** bold, * italic, _italic_, `code` işaretlerini gizle ama text'i tut
    const clean = raw
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(?<!\*)\*([^*\n]+)\*/g, '$1')
      .replace(/_([^_\n]+)_/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    if (highlightTerms.length === 0) return clean;
    const escaped = highlightTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // Sadece tam kelime — word boundary. "ai" gibi 2-3 harfli generic kelimeler highlight olmaz.
    const regex = new RegExp(`(?:(?<=^)|(?<=[^a-zA-Z0-9]))(${escaped.join('|')})(?=$|[^a-zA-Z0-9])`, 'gi');
    const matchTest = new RegExp(`^(${escaped.join('|')})$`, 'i');
    const parts = clean.split(regex);
    return parts.map((p, i) =>
      matchTest.test(p) ? (
        <mark key={i} className="bg-amber-300/40 dark:bg-amber-400/30 text-foreground rounded px-1 font-semibold not-italic">
          {p}
        </mark>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  };

  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastResults, setLastResults] = useState<any[] | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  // Test geçmişi — her koşum kalıcı (AiCitationRun); iki koşum karşılaştırılabilir
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRuns, setSelectedRuns] = useState<string[]>([]);
  const loadRuns = async () => {
    try { setRuns(await api.getCitationRuns(siteId, 30)); } catch { /* gecmis yoksa sessiz */ }
  };
  const toggleRun = (id: string) => {
    setSelectedRuns((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur.slice(-1), id]);
  };
  const showRun = async (id: string) => {
    try {
      const run = await api.getCitationRun(siteId, id);
      setLastResults(run.providers);
      setLastRunAt(run.runAt);
      setShowDetails(true);
    } catch (err: any) { toast.error(err.message); }
  };

  const load = async (d: number) => {
    setLoading(true);
    try {
      const res = await api.getCitationHistory(siteId, d);
      setData(res);
      // Backend son snapshot probe'larini da donduriyor — F5 sonrasi panelin canlanmasi icin.
      // Snapshot satiri aralik tasimaz; son olcumun asistan araligi olcum blogundan eklenir.
      if (res?.latestResults?.length > 0 && !lastResults) {
        const son = olcumOf(res)?.son;
        setLastResults(res.latestResults.map((r: any) => ({ ...r, gorunme: son?.asistanlar?.[r.provider] ?? null })));
        setLastRunAt(res.latestRunAt ?? null);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, [days, siteId]);
  useEffect(() => { loadRuns(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [siteId]);

  const { blocked: measurementBlocked } = useMeasurementAllowance();

  const triggerSnapshot = async () => {
    setRunning(true);
    try {
      const res: any = await api.triggerCitationSnapshot(siteId);
      if (res?.results) {
        setLastResults(res.results);
        setLastRunAt(res.runAt ?? new Date().toISOString());
        setShowDetails(true);
      }
      toast.success('AI görünürlük testi çalıştı — önceki testler geçmişte duruyor, grafik ve detaylar güncellendi');
      refreshMeasurementAllowance();
      await load(days);
      await loadRuns();
    } catch (err: any) {
      if (isWeeklyMeasurementLimitError(err)) refreshMeasurementAllowance();
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const colorForScore = (s: number | null) => {
    if (s === null) return 'text-muted-foreground';
    if (s >= 60) return 'text-emerald-500';
    if (s >= 30) return 'text-amber-500';
    return 'text-red-500';
  };

  if (loading || !data) {
    return <div className="text-sm text-muted-foreground p-6 text-center">AI görünürlük tarihçesi yükleniyor…</div>;
  }

  const byProvider = data.byProvider ?? {};
  const trends = data.trends ?? [];
  // Olcum belirsizligi (API olcum blogu): ±X, "N tekrar × M soru", ön sonuç ve
  // "arttı/azaldı yalnız aralıklar örtüşmüyorsa" kararlari — eski API'de yok
  const olcum = olcumOf(data);
  const tekrarSoru = tekrarSoruEtiketi(olcum?.son);
  const sortedDates = [...new Set(Object.values(byProvider).flatMap((pts: any) => pts.map((pt: any) => pt.date as string)))].sort();

  // Olcum yontemi degisim gunu (API trends[].methodChangedAt) — grafikte kesikli cizgi
  const breakDates: string[] = trends.map((t: any) => t.methodChangedAt).filter((d: unknown): d is string => typeof d === 'string').sort();
  const methodBreak: string | null = breakDates.length > 0 && sortedDates.includes(breakDates[0]) ? breakDates[0].slice(5) : null;

  // recharts veri formati: [{date, anthropic: 80, ...}]; yontem degisiminden onceki
  // noktalar ayri ("__eski") seride — iki yontem tek cizgiyle BAGLANMAZ
  const { rows: chartData, series: chartSeries } = splitSeriesByMethod(byProvider, trends);

  // Son olcumde sorulan sorular (saglayicilar ayni sorulari sorar; tekillestirilir)
  const testQueries: string[] = [...new Set<string>(
    (data.latestResults ?? []).flatMap((r: any) => (Array.isArray(r.probes) ? r.probes : []).map((p: any) => String(p.query ?? '').trim())),
  )].filter(Boolean).slice(0, 5);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" /> AI Görünürlük Trendi
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              Planındaki AI asistanlarına (ChatGPT, Gemini, Claude, Perplexity; Profesyonel ve üstü planlarda ayrıca Grok ve DeepSeek) sektörünle ilgili sorular sorduğumuzda <strong>cevapta site URL'in veya marka adın geçiyor mu</strong> ölçüyoruz. <strong>0-100 skor:</strong> URL geçerse 100 puan, sadece marka adı geçerse 50 puan/soru. Sorusunda marka adın geçen ve sağlayıcının yanıtlayamadığı sorular skora girmez.
            </p>
            {/*
              Tekrar + aralik (08.11.2026 kanit denetimi, api audit/citation-repeat.ts): AI cevaplari
              turdan tura cok oynak (Ahrefs: AI Overview icerigi iki gozlem arasinda %70 degisiyor;
              Sistrix: ChatGPT'de alintilanan alan adlarinin %74'u haftadan haftaya degisiyor) — tek
              tur kesin sonuc degil. Her soru her asistana birden fazla kez sorulur.
            */}
            <p className="text-label text-muted-foreground mt-0.5 max-w-2xl">
              {olcum?.son && olcum.son.tekrar > 1
                ? <>AI cevapları turdan tura değiştiği için her soru her asistana {olcum.son.tekrar} kez, birbirinden bağımsız sorulur; skor tüm tekrarlardan hesaplanır. </>
                : <>Son ölçümde her soru her asistana bir kez soruldu; AI cevapları turdan tura değiştiği için tek tur kesin sonuç değildir. </>}
              Skorun yanındaki <strong>±</strong> görünme sıklığının %95 güven aralığının yarısıdır: iki ölçüm arasındaki fark yalnız aralıklar örtüşmüyorsa “arttı/azaldı” diye gösterilir.
            </p>
            {/*
              Eski metin "cevaplarin yaklasik dortte biri reklam iceriyor" diyordu: ucuncu taraf
              izleyiciler 2026'da %3 ile %51 arasinda birbirini tutmayan oranlar olcuyor (bolgeye,
              doneme, yonteme gore) — tek bir oran dogrulanamaz, kaldirildi. Dogrulanan: OpenAI'a gore
              reklamlar cevabin altinda, ayri ve etiketli gosterilir ve cevaplari etkilemez.
              - NBC News, 16.01.2026: https://www.nbcboston.com/news/tech/ads-are-coming-to-chatgpt/3879284/
              - PPC Land, 16.01.2026: https://ppc.land/openai-finally-pulls-trigger-on-chatgpt-ads-after-monthslong-delay/
            */}
            <p className="text-label text-muted-foreground mt-0.5 max-w-2xl">
              Ölçüm sağlayıcıların API&apos;si üzerinden yapılır; tüketici uygulamalarındaki reklamlar ölçüme girmez. OpenAI&apos;a göre ChatGPT&apos;de gösterilen reklamlar cevabın altında, ayrı ve etiketli durur ve cevapları etkilemez — yani reklam vermek cevapta kaynak gösterilmeyi sağlamaz.
            </p>
            {/*
              Hangi sorular soruluyor: test Prompt Lab'den BAGIMSIZ, site profilindeki (brain)
              ilk 5 soruyu her olcumde ayni sorar — egilim kiyaslanabilir kalsin diye (sahip
              karari 02.11.2026). Musteri "Prompt Lab bos, neye gore olcuyor?" diye soruyordu.
            */}
            {testQueries.length > 0 && (
              <details className="mt-1 max-w-2xl text-label text-muted-foreground">
                <summary className="cursor-pointer select-none hover:text-foreground">
                  Bu test hangi soruları soruyor? ({testQueries.length} soru, her ölçümde aynı)
                </summary>
                <ol className="mt-1 ml-4 list-decimal space-y-0.5">
                  {testQueries.map((q) => <li key={q}>{q}</li>)}
                </ol>
                <p className="mt-1">
                  Sorular sitenin profilinden gelir ve her ölçümde aynı kalır; böylece değişim kıyaslanabilir.
                  Kendi sorularını <Link href={`/sites/${siteId}/geo-lab`} className="underline hover:text-foreground">GEO Lab → Prompt Lab</Link>&apos;de ayrıca ölçebilirsin; o sorular bu skoru değiştirmez.
                </p>
              </details>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex gap-1">
              {[7, 30, 90, 365].map((d) => (
                <FilterChip key={d} selected={days === d} onClick={() => setDays(d)}>
                  {d}g
                </FilterChip>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={triggerSnapshot} disabled={running || measurementBlocked}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${running ? 'animate-spin' : ''}`} /> Yeniden Test
            </Button>
          </div>
        </div>
        <MeasurementLimitNote className="mb-3" />

        {sortedDates.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Henüz AI görünürlük snapshot'ı yok. "Yeniden Test" tıklayarak ilk veri noktasını oluştur.
          </div>
        ) : (
          <>
            {/* RanksUp Etkisi — before/after değer kartı */}
            <BeforeAfterCard data={data} />

            {/* Yorumlama Kartı — 7 günlük ortalama manşet (backend citation-headline.ts, tek kaynak) */}
            {(() => {
              const headline = data.headline ?? null;
              const avg: number | null = headline?.score ?? null;
              if (avg === null) return null;
              // Sağlayıcı sıralaması manşetle aynı kuralı izler: ≥2 ölçüm varsa 7g ortalaması, yoksa son ölçüm
              const pick = (t: any): number | null =>
                typeof t.last7Avg === 'number' && t.runCount >= 2 ? t.last7Avg : (typeof t.last === 'number' ? t.last : null);
              const sorted = [...trends].filter((t: any) => pick(t) !== null).sort((a: any, b: any) => (pick(b) as number) - (pick(a) as number));
              const best = sorted[0];
              const worst = sorted[sorted.length - 1];
              const windowLabel = headline.method === 'rolling'
                ? `7 günlük ortalama · ${headline.runCount} ölçüm`
                : 'ilk ölçüm';
              const stability = data.stability ?? null;
              const STABILITY: Record<string, { text: string; cls: string; hint: string }> = {
                'istikrarli':    { text: 'istikrarlı', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30', hint: 'Günlük dalgalanma örnekleme gürültüsü sınırında — hareketler büyük olasılıkla gerçek değil.' },
                'dalgali':       { text: 'dalgalı',    cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',       hint: 'Günlük dalgalanma gürültünün üstünde — tek günlük değişimlere göre karar verme.' },
                'oynak':         { text: 'oynak',      cls: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',               hint: 'AI cevapları günden güne belirgin değişiyor — 7 günlük ortalamaya bak, tek güne değil.' },
                'yetersiz-veri': { text: 'veri az',    cls: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/30',           hint: 'Oynaklık için en az 4 ölçüm günü gerekir.' },
              };
              const st = stability ? STABILITY[stability.label] : null;
              // Skorun belirsizligi: manset penceresindeki olcumlerin birlesik gorunme araligi
              const mansetAralik: GorunmeAraligi | null = olcum?.manset?.gorunme ?? null;
              const pm = plusMinus(mansetAralik);
              const pmIpucu = aralikAciklamasi(mansetAralik) ?? undefined;

              // "Kaynak oldun, öneri değilsin" — son ölçümde URL atıf aldı ama marka adı cevapta geçmedi (markasız sorular)
              const latestProbes: any[] = (data.latestResults ?? []).flatMap((r: any) => Array.isArray(r.probes) ? r.probes : []);
              const unbrandedProbes = latestProbes.filter((p: any) => p.brandInQuery !== true && !String(p.excerpt ?? '').startsWith('HATA:'));
              const citedNotMentioned = unbrandedProbes.filter((p: any) => p.cited && !p.brandMentioned).length;

              const grade =
                avg >= 75 ? { label: 'Mükemmel', tone: 'emerald', desc: 'AI motorları sitenizi çok iyi tanıyor.' } :
                avg >= 50 ? { label: 'İyi', tone: 'orange',  desc: 'Marka adınız tanınıyor, hedef: URL citation almak.' } :
                avg >= 25 ? { label: 'Orta',  tone: 'amber',   desc: 'Bazı AI\'lar markanı kısmen tanıyor. Daha fazla içerik üretmek gerek.' } :
                            { label: 'Düşük', tone: 'red',     desc: 'AI motorları markanı henüz tanımıyor. İçerik üretmen ve indekslenmen kritik.' };

              const toneClasses: Record<string, string> = {
                emerald: 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.06] to-emerald-500/[0.02] text-emerald-700 dark:text-emerald-300',
                orange:  'border-brand-500/30 bg-gradient-to-br from-brand-500/[0.06] to-brand-500/[0.02] text-brand-700 dark:text-brand-300',
                amber:   'border-amber-500/30 bg-gradient-to-br from-amber-500/[0.06] to-amber-500/[0.02] text-amber-700 dark:text-amber-300',
                red:     'border-red-500/30 bg-gradient-to-br from-red-500/[0.06] to-red-500/[0.02] text-red-700 dark:text-red-300',
              };

              return (
                <div className={`rounded-xl border p-3.5 mb-3 ${toneClasses[grade.tone]}`}>
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="text-center min-w-[78px] shrink-0">
                      <div className="text-3xl font-bold leading-none">
                        {avg}
                        {pm && <span className="text-base font-semibold opacity-70 ml-1 whitespace-nowrap" title={pmIpucu}>{pm}</span>}
                      </div>
                      <div className="text-label font-medium mt-1 opacity-70">/ 100</div>
                    </div>
                    <div className="flex-1 min-w-[220px]">
                      <p className="text-sm font-bold flex items-center gap-2 flex-wrap">
                        <span>{grade.label} — AI görünürlük <span className="font-normal opacity-70">({windowLabel})</span></span>
                        {olcum?.onSonuc && (
                          <span
                            className="text-label font-semibold border rounded-full px-2 py-0.5 bg-zinc-500/10 text-zinc-700 dark:text-zinc-200 border-zinc-500/30"
                            title="Bu ölçüm yöntemiyle henüz tek ölçüm var. AI cevapları turdan tura değiştiği için bir sonraki ölçümle birlikte okunmalı."
                          >
                            ön sonuç
                          </span>
                        )}
                        {st && (
                          <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 ${st.cls}`} title={`${st.hint}${stability?.ratio !== null && stability?.ratio !== undefined ? ` (gözlenen/beklenen sapma ${stability.ratio}×, ${stability.dayCount} gün)` : ''}`}>
                            {st.text}
                          </span>
                        )}
                      </p>
                      <p className="text-xs opacity-90 mt-0.5">{grade.desc}</p>
                      {(tekrarSoru || pm) && (
                        <p className="text-label mt-1 opacity-80" title={pmIpucu}>
                          {tekrarSoru && <>Son ölçüm: <strong>{tekrarSoru}</strong></>}
                          {tekrarSoru && pm && ' · '}
                          {pm && mansetAralik && <>{pm}: görünme sıklığı %{Math.round(mansetAralik.oran)} (%95 güven aralığı %{Math.round(mansetAralik.alt)}–%{Math.round(mansetAralik.ust)})</>}
                        </p>
                      )}
                      {headline.methodChanged && (
                        <p className="text-label mt-1 opacity-80">
                          Ölçüm yöntemi{headline.methodChangedAt ? ` ${formatTrDate(headline.methodChangedAt)} tarihinde` : ''} güncellendi — önceki haftayla kıyas yok; ortalama yalnız yeni yöntemle yapılan ölçümleri içerir.
                        </p>
                      )}
                      <div className="text-[11px] mt-2 opacity-80 leading-relaxed">
                        {best && (
                          <span>✅ En iyi: <strong>{PROVIDER_LABELS[best.provider] ?? best.provider}</strong> ({pick(best)} puan)</span>
                        )}
                        {worst && best?.provider !== worst?.provider && (
                          <span> · ❌ En zayıf: <strong>{PROVIDER_LABELS[worst.provider] ?? worst.provider}</strong> ({pick(worst)} puan)</span>
                        )}
                        {citedNotMentioned > 0 && (
                          <div className="mt-1" title="Site URL'i kaynak gösterildi ama marka adı cevapta geçmedi: içeriğin cevabın malzemesi olmuş, önerisi olmamış. Yalnız anılmayı ölçen raporlar bunu göremez.">
                            🔗 Atıf var · ad anılmadı: <strong>{citedNotMentioned}/{unbrandedProbes.length}</strong> ölçüm (son koşum) — kaynak oldun, öneri değilsin
                          </div>
                        )}
                      </div>
                      {avg < 50 && (
                        <div className="text-[11px] mt-2 opacity-90 leading-relaxed bg-card/50 rounded-md px-2 py-1.5 border border-current/10">
                          {/* Eski metin "genelde 2-4 hafta sonra skor +15-30 artar" diyordu — kaynaksiz sayi ve sure vaadi, kaldirildi */}
                          <strong>Ne yapmalı:</strong> Sektör sorularını yanıtlayan içerik yayınla ve indekslenmesini sağla. Ölçümde asistanların hepsi web'de arama yapar ve yeni içeriği kaynak olarak bulabilir; etkinin ne zaman ve ne kadar görüneceği garanti edilemez — değişimi sonraki ölçümlerle izle.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Trend rozetler */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              {trends.map((t: any) => {
                const color = PROVIDER_COLORS[t.provider] ?? PROVIDER_FALLBACK;
                const label = PROVIDER_LABELS[t.provider] ?? t.provider;
                // İlk → son farkı yalnız görünme aralıkları örtüşmüyorsa "arttı/azaldı" (API olcum.asistanlar)
                const k = olcum?.asistanlar?.[t.provider] ?? null;
                const yon = kararYonu(k?.karar);
                return (
                  <div key={t.provider} className="rounded-md border p-2 flex items-center gap-2">
                    <EngineLogo provider={t.provider} size={20} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="flex items-center gap-1.5 text-xs font-medium">
                        <span className="truncate">{label}</span>
                        {/* Grafik cizgisinin rengi — lejant isareti */}
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} aria-hidden />
                      </p>
                      {t.methodChanged && t.delta === null ? (
                        // Yeni yontemle tek olcum: eski yontemli baslangicla kiyas yapilmaz
                        <p className="text-label text-muted-foreground" title={t.methodChangedAt ? `Ölçüm yöntemi ${formatTrDate(t.methodChangedAt)} tarihinde güncellendi` : undefined}>
                          <strong>{t.last ?? '—'}</strong> · ölçüm yöntemi güncellendi — kıyas yok
                        </p>
                      ) : (
                        <p
                          className="text-label text-muted-foreground"
                          title={[
                            t.methodChanged && t.methodChangedAt ? `Kıyas, ölçüm yönteminin güncellendiği ${formatTrDate(t.methodChangedAt)} tarihinden sonraki ölçümlerle.` : null,
                            t.delta !== null ? kararAciklamasi(k) : null,
                          ].filter(Boolean).join(' ') || undefined}
                        >
                          {t.first ?? '—'} → <strong>{t.last ?? '—'}</strong>
                          {t.delta !== null && t.delta !== 0 && yon !== 'flat' && (
                            <span className={`ml-1 ${yon === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                              {t.delta > 0 ? '+' : ''}{t.delta}
                            </span>
                          )}
                          {t.delta !== null && (t.delta === 0 || yon === 'flat') && (
                            <span className="ml-1">· anlamlı değişim yok</span>
                          )}
                        </p>
                      )}
                    </div>
                    {t.delta !== null && (
                      t.delta !== 0 && yon === 'up' ? <TrendingUp className="h-3.5 w-3.5 text-green-500" /> :
                      t.delta !== 0 && yon === 'down' ? <TrendingDown className="h-3.5 w-3.5 text-red-500" /> :
                      <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Trend grafigi — recharts: responsive (eski sabit 720px SVG yerine), tooltip'li */}
            <ChartContainer height={220}>
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid {...CHART_GRID} strokeDasharray="2 4" />
                <XAxis dataKey="date" {...CHART_AXIS} interval="preserveStartEnd" minTickGap={28} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...CHART_AXIS} width={38} />
                <Tooltip content={<ChartTooltip />} />
                {/* Olcum yontemi degisim gunu — cizginin bu noktadaki kirilmasi yontemden olabilir */}
                {methodBreak && (
                  <ReferenceLine
                    x={methodBreak}
                    stroke={CHART[8]}
                    strokeDasharray="4 4"
                    label={{ value: 'yöntem güncellendi', position: 'insideTopRight', fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  />
                )}
                {chartSeries.map(({ key, provider: p, legacy }) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={`${PROVIDER_LABELS[p] ?? p}${legacy ? ' (önceki yöntem)' : ''}`}
                    stroke={PROVIDER_COLORS[p] ?? PROVIDER_FALLBACK}
                    strokeWidth={legacy ? 1.5 : 2}
                    strokeOpacity={legacy ? 0.4 : 1}
                    strokeDasharray={legacy ? '3 3' : undefined}
                    dot={{ r: 2.5, strokeWidth: 0, fill: PROVIDER_COLORS[p] ?? PROVIDER_FALLBACK, fillOpacity: legacy ? 0.4 : 1 }}
                    activeDot={{ r: 4 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>

            {/* Test geçmişi — her koşum kalıcı; iki koşumu karşılaştır */}
            {runs.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <p className="text-xs font-semibold">Test geçmişi <span className="font-normal text-muted-foreground">({runs.length} koşum — hiçbiri silinmez; iki tanesini seçip karşılaştır)</span></p>
                  <Button
                    size="sm"
                    onClick={() => {
                      // NEDEN dogrudan rapor: kullanici karsilastirmayi panelde ozet olarak degil
                      // A4 rapor olarak istiyor (02.09). Iki adim (karsilastir → raporu ac) kaldirildi.
                      window.location.href = `/sites/${siteId}/gorunurluk-raporu?a=${encodeURIComponent(selectedRuns[0])}&b=${encodeURIComponent(selectedRuns[1])}`;
                    }}
                    disabled={selectedRuns.length !== 2}
                    title="Seçili iki koşumun A4 yazdırılabilir karşılaştırma raporunu aç"
                  >
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    Karşılaştır ({selectedRuns.length}/2)
                  </Button>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-md border divide-y divide-border/50">
                  {runs.map((r: any) => (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                      <input type="checkbox" checked={selectedRuns.includes(r.id)} onChange={() => toggleRun(r.id)} aria-label="karşılaştırmak için seç" />
                      <span className="tabular-nums w-[120px] shrink-0">{new Date(r.runAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${r.trigger === 'system' ? 'text-muted-foreground' : 'text-brand-700 dark:text-brand-300 border-brand-500/30 bg-brand-500/10'}`}>
                        {r.trigger === 'system' ? 'otomatik' : 'senin testin'}
                      </span>
                      <span className="font-semibold tabular-nums" title={aralikAciklamasi(r.gorunme) ?? undefined}>
                        {r.headlineScore ?? '—'}<span className="text-muted-foreground font-normal">/100</span>
                        {r.headlineScore != null && plusMinus(r.gorunme) && <span className="text-muted-foreground font-normal ml-1">{plusMinus(r.gorunme)}</span>}
                        {typeof r.tekrar === 'number' && r.tekrar > 1 && <span className="text-muted-foreground font-normal ml-1">· {r.tekrar} tekrar</span>}
                      </span>
                      <span className="text-muted-foreground truncate flex-1 min-w-0">
                        {r.providers.filter((p: any) => p.available).map((p: any) => `${PROVIDER_LABELS[p.provider] ?? p.provider} ${p.score ?? '—'}`).join(' · ')}
                      </span>
                      <button type="button" className="text-brand-600 dark:text-brand-400 hover:underline shrink-0" onClick={() => showRun(r.id)}>detay</button>
                    </div>
                  ))}
                </div>

              </div>
            )}

            {/* Son test detayları — her provider için probe-by-probe */}
            {lastResults && lastResults.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1"
                >
                  {showDetails ? '▾' : '▸'} Son test detaylarını {showDetails ? 'gizle' : 'göster'} — hangi sorularda neye cevap geldi?
                </button>

                {showDetails && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      Her AI asistanına aynı soruları (en fazla 5{lastResults.some((r: any) => (r.probes ?? []).some((p: any) => typeof p.tekrar === 'number' && p.tekrar > 1)) ? ', her birini birden fazla kez, birbirinden bağımsız' : ''}) sorduk. Aşağıda her sorunun cevabında <strong>URL geçti mi (✓)</strong>, sadece <strong>marka adı geçti mi (~)</strong> veya <strong>hiç geçmedi mi (✗)</strong> görüyorsun; tekrarlı ölçümde her tekrarın sonucu yan yana.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {lastResults.map((r: any) => (
                        <div key={r.provider} className="rounded-lg border p-3 bg-card">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <EngineLogo provider={r.provider} size={18} />
                              <span className="text-xs font-semibold">{PROVIDER_LABELS[r.provider] ?? r.label ?? r.provider}</span>
                            </div>
                            <span className={`text-lg font-bold ${colorForScore(r.score)}`} title={aralikAciklamasi(r.gorunme) ?? undefined}>
                              {r.score === null ? '—' : r.score}
                              {r.score !== null && plusMinus(r.gorunme) && (
                                <span className="text-xs font-semibold text-muted-foreground ml-1">{plusMinus(r.gorunme)}</span>
                              )}
                            </span>
                          </div>
                          {(() => {
                            // Tum sorulari HATA olan saglayici "olculemedi"dir (API available:false, skor null);
                            // soru bazli nedenler asagidaki satirlarda — burada genel durum
                            const probes: any[] = Array.isArray(r.probes) ? r.probes : [];
                            const allFailed = probes.length > 0 && probes.every((p: any) => isProbeErrorText(p.excerpt));
                            if (allFailed) {
                              return <p className="text-label text-muted-foreground mb-2 leading-snug">Bu sağlayıcıda hiçbir soru ölçülemedi; skor hesaplanmadı.</p>;
                            }
                            return r.reason ? <p className="text-[11px] text-muted-foreground mb-2 leading-snug">{displayProbeText(r.reason)}</p> : null;
                          })()}

                          {/* Aggregate metrics — avg position + sentiment mix + share of voice */}
                          {(r.avgPosition || r.sentimentMix || r.shareOfVoice?.length) && (
                            <div className="mb-3 -mx-1 px-1 py-2 border-y bg-muted/20 rounded text-[10px] space-y-1.5">
                              {/* Row 1: position + sentiment */}
                              <div className="flex items-center justify-between gap-2">
                                {r.avgPosition && (
                                  <div className="flex items-center gap-1">
                                    <span className="text-muted-foreground">Ort. sıra:</span>
                                    <span className="font-bold tabular-nums">#{r.avgPosition.toFixed(1)}</span>
                                  </div>
                                )}
                                {r.sentimentMix && (
                                  <div className="flex items-center gap-1.5">
                                    {r.sentimentMix.positive > 0 && (
                                      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-semibold">
                                        😊 {r.sentimentMix.positive}
                                      </span>
                                    )}
                                    {r.sentimentMix.neutral > 0 && (
                                      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-500/15 text-slate-700 dark:text-slate-300 font-semibold">
                                        😐 {r.sentimentMix.neutral}
                                      </span>
                                    )}
                                    {r.sentimentMix.negative > 0 && (
                                      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-400 font-semibold">
                                        😟 {r.sentimentMix.negative}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              {/* Row 2: share of voice bar */}
                              {r.shareOfVoice?.length > 1 && (
                                <div>
                                  <div className="text-muted-foreground mb-0.5">Share of Voice</div>
                                  <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                                    {r.shareOfVoice.slice(0, 5).map((sov: any, i: number) => (
                                      <div
                                        key={i}
                                        className={sov.isBrand ? 'bg-brand-500' : ['bg-slate-400', 'bg-slate-500', 'bg-slate-600', 'bg-slate-700'][i % 4]}
                                        style={{ width: `${sov.pct}%` }}
                                        title={`${sov.name}: %${sov.pct} (${sov.mentions}x)`}
                                      />
                                    ))}
                                  </div>
                                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                                    {r.shareOfVoice.slice(0, 4).map((sov: any, i: number) => (
                                      <span key={i} className={`text-[9px] ${sov.isBrand ? 'text-brand-600 dark:text-brand-400 font-bold' : 'text-muted-foreground'}`}>
                                        <span className="inline-block w-1.5 h-1.5 rounded-full mr-0.5 align-middle" style={{ backgroundColor: sov.isBrand ? CHART[1] : CHART[8] }} />
                                        {sov.name} %{sov.pct}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {r.probes?.length > 0 && (
                            <ul className="space-y-2.5">
                              {sorularaGore<any>(r.probes).map((g, gi) => {
                                // Tekrarli olcumde ayni soru N kez gelir: soru bir kez yazilir,
                                // tekrarlarin sonucu yan yana. Tek elemanli grup (eski kayit,
                                // N=1) eski satir gorunumunu korur.
                                const durumlar = g.probes.map(probeDurumu);
                                const coklu = g.probes.length > 1;
                                const p = g.probes[0];
                                const status = durumlar[0];
                                // Bar rengi: grubun en iyi OLCULEN sonucu (URL > marka > yok); hepsi skor disiysa gri
                                const enIyi = durumlar.reduce((a, b) => (TON_SIRA[b.tone] > TON_SIRA[a.tone] ? b : a), durumlar[0]);
                                const c = TON_SINIF[coklu ? enIyi.tone : status.tone];
                                const olculen = g.probes.filter((x: any) => !isProbeErrorText(x.excerpt));
                                const sayilan = olculen.filter((x: any) => !x.brandInQuery);
                                const gorunen = sayilan.filter((x: any) => x.cited || x.brandMentioned).length;
                                const hata = g.probes.find((x: any) => isProbeErrorText(x.excerpt));
                                return (
                                  <li key={gi} className="relative pl-3">
                                    <span className={`absolute left-0 top-1 bottom-1 w-1 rounded-full ${c.bar}`} />
                                    {coklu ? (
                                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                        {durumlar.map((d, i) => (
                                          <span key={i} className={`text-label font-bold tracking-wide px-1.5 py-0.5 rounded ${TON_SINIF[d.tone].badge}`} title={`${i + 1}. tekrar: ${d.label}`}>
                                            {i + 1}. {d.kisa}
                                          </span>
                                        ))}
                                        <span className="text-label text-muted-foreground">
                                          {sayilan.length > 0
                                            ? `${sayilan.length} tekrarın ${gorunen}'ında göründü`
                                            : p.brandInQuery ? 'markalı soru · skor dışı' : 'ölçülemedi · skor dışı'}
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                                        <span className={`text-label font-bold tracking-wide px-1.5 py-0.5 rounded ${c.badge}`}>
                                          {status.label}
                                        </span>
                                        <span className={`text-label font-mono font-bold ${TON_SINIF[status.tone].text}`}>
                                          {status.score}
                                        </span>
                                        {p.position && (
                                          <span className="text-label font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-400" title={`AI cevabında ${p.position}. paragrafta geçtin`}>
                                            #{p.position}
                                          </span>
                                        )}
                                        {p.sentiment === 'positive' && (
                                          <span className="text-label font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">😊 POZİTİF</span>
                                        )}
                                        {p.sentiment === 'negative' && (
                                          <span className="text-label font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-400">😟 NEGATİF</span>
                                        )}
                                        {p.sentiment === 'neutral' && (
                                          <span className="text-label font-bold px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-700 dark:text-slate-300">😐 NÖTR</span>
                                        )}
                                        {p.competitors?.length > 0 && (
                                          <span className="text-label px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400" title={p.competitors.map((c: any) => `${c.name} (${c.mentions}x)`).join(', ')}>
                                            🥊 {p.competitors.length} rakip
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    <p className="text-[11px] font-medium leading-snug mb-1">{g.query}</p>
                                    {/* Olculemeyen soru: ham saglayici metni degil, Turkce neden (lib/probe-error-text) */}
                                    {hata && olculen.length === 0 && (
                                      <p className="text-label text-muted-foreground">{probeErrorText(hata.excerpt)}</p>
                                    )}
                                    {olculen.some((x: any) => x.excerpt) && (
                                      <details className="group">
                                        <summary className="text-label cursor-pointer text-muted-foreground hover:text-foreground select-none list-none inline-flex items-center gap-1">
                                          <span className="group-open:rotate-90 inline-block transition-transform">▸</span>
                                          {coklu ? 'AI’ın cevaplarını göster' : 'AI’ın cevabını göster'}
                                        </summary>
                                        <div className="mt-1.5 p-2 rounded-md bg-muted/40 border text-label leading-relaxed text-foreground/80 max-h-32 overflow-y-auto space-y-1.5">
                                          {g.probes.map((x: any, i: number) => (
                                            x.excerpt && !isProbeErrorText(x.excerpt) ? (
                                              <p key={i}>
                                                {coklu && <strong className="text-muted-foreground">{i + 1}. tekrar: </strong>}
                                                {renderExcerpt(x.excerpt)}
                                              </p>
                                            ) : null
                                          ))}
                                        </div>
                                      </details>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                    {lastRunAt && (
                      <p className="text-[11px] text-muted-foreground">
                        Son test: {new Date(lastRunAt).toLocaleString('tr-TR')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
