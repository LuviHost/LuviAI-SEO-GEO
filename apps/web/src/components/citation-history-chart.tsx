'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { TrendingUp, TrendingDown, Minus, Sparkles, RefreshCw, Download, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BeforeAfterCard } from '@/components/before-after-card';
import { PROVIDER_COLORS, PROVIDER_LABELS, PROVIDER_FALLBACK } from '@/lib/chart-colors';



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
      // Backend son snapshot probe'larini da donduriyor — F5 sonrasi panelin canlanmasi icin
      if (res?.latestResults?.length > 0 && !lastResults) {
        setLastResults(res.latestResults);
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
      await load(days);
      await loadRuns();
    } catch (err: any) {
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
  const providers = Object.keys(byProvider).filter((p) => byProvider[p].length > 0);

  // Tum tarihleri topla, x-axis icin
  const allDates = new Set<string>();
  for (const p of providers) {
    for (const point of byProvider[p]) allDates.add(point.date);
  }
  const sortedDates = [...allDates].sort();

  // Skor map: provider -> date -> score
  const scoreMap: Record<string, Record<string, number | null>> = {};
  for (const p of providers) {
    scoreMap[p] = {};
    for (const point of byProvider[p]) {
      scoreMap[p][point.date] = point.score;
    }
  }

  const chartW = 720;
  const chartH = 200;
  const pad = { top: 16, right: 12, bottom: 24, left: 32 };
  const innerW = chartW - pad.left - pad.right;
  const innerH = chartH - pad.top - pad.bottom;

  const xStep = sortedDates.length > 1 ? innerW / (sortedDates.length - 1) : innerW;
  const y = (score: number) => innerH - (score / 100) * innerH;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-500" /> AI Görünürlük Trendi
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek ve Meta — 7 AI'a markanla ilgili soru sorduğumuzda <strong>cevapta site URL'in veya marka adın geçiyor mu</strong> ölçüyoruz. <strong>0-100 skor:</strong> URL geçerse 100 puan, sadece marka adı geçerse 50 puan/soru.
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5 max-w-2xl">
              Ölçüm sağlayıcıların API yüzeyinde yapılır. Tüketici uygulamasında (ChatGPT web) ayrıca bir reklam katmanı var — cevapların yaklaşık dörtte biri reklam içeriyor ve reklam vermek atıf getirmiyor; kaynak olmak yalnız içerikle mümkün.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex border rounded-md overflow-hidden">
              {[7, 30, 90, 365].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-2.5 py-1 text-xs font-medium ${
                    days === d ? 'bg-brand text-white' : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {d}g
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={triggerSnapshot} disabled={running}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${running ? 'animate-spin' : ''}`} /> Yeniden Test
            </Button>
          </div>
        </div>

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
                      <div className="text-3xl font-bold leading-none">{avg}</div>
                      <div className="text-[10px] uppercase tracking-wider font-bold mt-1 opacity-70">/ 100</div>
                    </div>
                    <div className="flex-1 min-w-[220px]">
                      <p className="text-sm font-bold flex items-center gap-2 flex-wrap">
                        <span>{grade.label} — AI görünürlük <span className="font-normal opacity-70">({windowLabel})</span></span>
                        {st && (
                          <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 ${st.cls}`} title={`${st.hint}${stability?.ratio !== null && stability?.ratio !== undefined ? ` (gözlenen/beklenen sapma ${stability.ratio}×, ${stability.dayCount} gün)` : ''}`}>
                            {st.text}
                          </span>
                        )}
                      </p>
                      <p className="text-xs opacity-90 mt-0.5">{grade.desc}</p>
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
                          💡 <strong>Ne yapmalı:</strong> Makale yayınla → IndexNow + Google Indexing ile hızlı indekslen → AI motorları siteyi web search'de bulup citation vermeye başlar. Genelde 2-4 hafta sonra skor +15-30 artar.
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
                return (
                  <div key={t.provider} className="rounded-md border p-2 flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{label}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {t.first ?? '—'} → <strong>{t.last ?? '—'}</strong>
                        {t.delta !== null && (
                          <span className={`ml-1 ${t.delta > 0 ? 'text-green-500' : t.delta < 0 ? 'text-red-500' : ''}`}>
                            {t.delta > 0 ? '+' : ''}{t.delta}
                          </span>
                        )}
                      </p>
                    </div>
                    {t.delta !== null && (
                      t.delta > 0 ? <TrendingUp className="h-3.5 w-3.5 text-green-500" /> :
                      t.delta < 0 ? <TrendingDown className="h-3.5 w-3.5 text-red-500" /> :
                      <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Line chart */}
            <div className="overflow-x-auto">
              <svg width={chartW} height={chartH} className="text-muted-foreground">
                {/* Grid */}
                {[0, 25, 50, 75, 100].map((g) => (
                  <g key={g}>
                    <line
                      x1={pad.left} y1={pad.top + y(g)}
                      x2={pad.left + innerW} y2={pad.top + y(g)}
                      stroke="currentColor" strokeOpacity={0.1} strokeDasharray="2 4"
                    />
                    <text x={pad.left - 6} y={pad.top + y(g) + 3} textAnchor="end" fontSize={10} fill="currentColor">
                      {g}
                    </text>
                  </g>
                ))}

                {/* Lines per provider */}
                {providers.map((p) => {
                  const color = PROVIDER_COLORS[p] ?? PROVIDER_FALLBACK;
                  const points = sortedDates
                    .map((d, i) => {
                      const s = scoreMap[p][d];
                      if (s === null || s === undefined) return null;
                      return `${pad.left + i * xStep},${pad.top + y(s)}`;
                    })
                    .filter(Boolean) as string[];
                  if (points.length === 0) return null;
                  return (
                    <g key={p}>
                      <polyline
                        points={points.join(' ')}
                        fill="none"
                        stroke={color}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      {points.map((pt, idx) => {
                        const [x, py] = pt.split(',').map(Number);
                        return <circle key={idx} cx={x} cy={py} r={3} fill={color} />;
                      })}
                    </g>
                  );
                })}

                {/* X axis dates (her 5 noktada bir label) */}
                {sortedDates.map((d, i) => {
                  if (i % Math.max(1, Math.floor(sortedDates.length / 6)) !== 0) return null;
                  return (
                    <text
                      key={d}
                      x={pad.left + i * xStep}
                      y={chartH - 6}
                      textAnchor="middle"
                      fontSize={9}
                      fill="currentColor"
                    >
                      {d.slice(5)}
                    </text>
                  );
                })}
              </svg>
            </div>

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
                      <span className="font-semibold tabular-nums">{r.headlineScore ?? '—'}<span className="text-muted-foreground font-normal">/100</span></span>
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
                      Her AI'a 5 farklı soru sorduk. Aşağıda her sorunun cevabında <strong>URL geçti mi (✓)</strong>, sadece <strong>marka adı geçti mi (~)</strong> veya <strong>hiç geçmedi mi (✗)</strong> görüyorsun.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {lastResults.map((r: any) => (
                        <div key={r.provider} className="rounded-lg border p-3 bg-card">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: PROVIDER_COLORS[r.provider] ?? PROVIDER_FALLBACK }}
                              />
                              <span className="text-xs font-semibold">{PROVIDER_LABELS[r.provider] ?? r.label ?? r.provider}</span>
                            </div>
                            <span className={`text-lg font-bold ${colorForScore(r.score)}`}>
                              {r.score === null ? '—' : r.score}
                            </span>
                          </div>
                          {r.reason && (
                            <p className="text-[11px] text-muted-foreground mb-2 leading-snug">{r.reason}</p>
                          )}

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
                                        <span className="inline-block w-1.5 h-1.5 rounded-full mr-0.5 align-middle" style={{ backgroundColor: sov.isBrand ? '#f97316' : '#94a3b8' }} />
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
                              {r.probes.map((p: any, i: number) => {
                                // Markalı soru: skor bu probe'ları saymaz — +100/+50 rozeti
                                // basılırsa kullanıcı rozetleri toplayıp skoru tutturamaz.
                                const status = p.brandInQuery
                                  ? { label: 'MARKALI SORU · SKOR DIŞI', tone: 'slate', score: '—' }
                                  : p.cited
                                    ? { label: 'URL ALINTIDI', tone: 'emerald', score: '+100' }
                                    : p.brandMentioned
                                      ? { label: 'MARKA GEÇTI', tone: 'amber', score: '+50' }
                                      : { label: 'BAHSETMEDI', tone: 'red', score: '0' };
                                const toneClasses: Record<string, { badge: string; bar: string }> = {
                                  emerald: {
                                    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30',
                                    bar: 'bg-emerald-500',
                                  },
                                  amber: {
                                    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30',
                                    bar: 'bg-amber-500',
                                  },
                                  slate: {
                                    badge: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 ring-1 ring-slate-500/30',
                                    bar: 'bg-slate-400',
                                  },
                                  red: {
                                    badge: 'bg-red-500/15 text-red-700 dark:text-red-300 ring-1 ring-red-500/30',
                                    bar: 'bg-red-500',
                                  },
                                };
                                const c = toneClasses[status.tone];
                                return (
                                  <li key={i} className="relative pl-3">
                                    <span className={`absolute left-0 top-1 bottom-1 w-1 rounded-full ${c.bar}`} />
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                      <span className={`text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded ${c.badge}`}>
                                        {status.label}
                                      </span>
                                      <span className={`text-[10px] font-mono font-bold ${status.tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : status.tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                                        {status.score}
                                      </span>
                                      {p.position && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-400" title={`AI cevabında ${p.position}. paragrafta geçtin`}>
                                          #{p.position}
                                        </span>
                                      )}
                                      {p.sentiment === 'positive' && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">😊 POZİTİF</span>
                                      )}
                                      {p.sentiment === 'negative' && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-400">😟 NEGATİF</span>
                                      )}
                                      {p.sentiment === 'neutral' && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-700 dark:text-slate-300">😐 NÖTR</span>
                                      )}
                                      {p.competitors?.length > 0 && (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400" title={p.competitors.map((c: any) => `${c.name} (${c.mentions}x)`).join(', ')}>
                                          🥊 {p.competitors.length} rakip
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] font-medium leading-snug mb-1">{p.query}</p>
                                    {p.excerpt && (
                                      <details className="group">
                                        <summary className="text-[10px] cursor-pointer text-muted-foreground hover:text-foreground select-none list-none inline-flex items-center gap-1">
                                          <span className="group-open:rotate-90 inline-block transition-transform">▸</span>
                                          AI'ın cevabını göster
                                        </summary>
                                        <div className="mt-1.5 p-2 rounded-md bg-muted/40 border text-[11px] leading-relaxed text-foreground/80 max-h-32 overflow-y-auto">
                                          {renderExcerpt(p.excerpt)}
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
