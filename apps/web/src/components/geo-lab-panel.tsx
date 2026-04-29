'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, Network, Globe, Check, X, AlertCircle, Copy, ExternalLink, Play } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * GEO Lab — gelismis GEO arac kutusu:
 *  1. Heatmap: sektor sorulari × AI provider matrix (yesil/kirmizi/sari/gri)
 *  2. Wikidata draft (Knowledge Graph icin)
 *  3. Wikipedia article draft
 */
export function GeoLabPanel({ siteId }: { siteId: string }) {
  const [tab, setTab] = useState<'heatmap' | 'wikidata' | 'wikipedia'>('heatmap');

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand" /> GEO Lab — Gelişmiş AI Görünürlük Araçları
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Heatmap'te rakipleri görün · Wikidata + Wikipedia ile kalıcı Knowledge Graph etkisi yaratın
        </p>
      </div>

      <div className="inline-flex border rounded-md overflow-hidden">
        {([
          ['heatmap', 'Heatmap', <Network key="h" className="h-3 w-3" />],
          ['wikidata', 'Wikidata', <Globe key="d" className="h-3 w-3" />],
          ['wikipedia', 'Wikipedia', <Globe key="w" className="h-3 w-3" />],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => setTab(id as any)}
            className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1 ${
              tab === id ? 'bg-brand text-white' : 'bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'heatmap' && <HeatmapTab siteId={siteId} />}
      {tab === 'wikidata' && <WikidataTab siteId={siteId} />}
      {tab === 'wikipedia' && <WikipediaTab siteId={siteId} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Heatmap
// ──────────────────────────────────────────────────────────────────
function HeatmapTab({ siteId }: { siteId: string }) {
  const [running, setRunning] = useState(false);
  const [data, setData] = useState<any>(null);

  const run = async () => {
    setRunning(true);
    try {
      const res = await api.runGeoHeatmap(siteId, 10);
      setData(res);
      toast.success(`Heatmap hazır: ${res.queries.length} sorgu × ${res.providers.length} AI`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted-foreground max-w-2xl">
          Sektör sorgularını Claude/Gemini/ChatGPT/Perplexity'ye sorar. Her hücre: <span className="text-green-500 font-bold">●</span> alıntılandın · <span className="text-yellow-500 font-bold">●</span> sadece marka adı geçti · <span className="text-red-500 font-bold">●</span> rakip alıntılandı · <span className="text-muted-foreground font-bold">●</span> kimse alıntılanmadı (fırsat)
        </p>
        <Button size="sm" onClick={run} disabled={running}>
          {running ? 'Test ediliyor (~60s)…' : '🎯 Heatmap Çalıştır'}
        </Button>
      </div>

      {data && (
        <div className="space-y-3">
          {/* Provider skor ozeti */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {data.providers.map((p: string, i: number) => {
              const pid = ['anthropic','gemini','openai','perplexity'][i];
              const score = data.scoreByProvider[pid] ?? 0;
              const color = score >= 60 ? 'text-green-500' : score >= 30 ? 'text-yellow-500' : 'text-red-500';
              return (
                <div key={p} className="rounded-md border p-2 text-center">
                  <p className="text-xs text-muted-foreground">{p}</p>
                  <p className={`text-2xl font-bold ${color}`}>{score}</p>
                </div>
              );
            })}
          </div>

          {/* Heatmap grid */}
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr>
                  <th className="text-left p-2 font-medium border-b">Sorgu</th>
                  {data.providers.map((p: string) => (
                    <th key={p} className="text-center p-2 font-medium border-b min-w-[80px]">{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.queries.map((q: string) => (
                  <tr key={q} className="border-b hover:bg-muted/30">
                    <td className="p-2 max-w-[300px]">
                      <p className="truncate" title={q}>{q}</p>
                    </td>
                    {data.providers.map((p: string, i: number) => {
                      const pid = ['anthropic','gemini','openai','perplexity'][i];
                      const cell = data.cells.find((c: any) => c.query === q && c.provider === pid);
                      const status = cell?.status ?? 'none';
                      const bg = status === 'cited' ? 'bg-green-500/30 border-green-500'
                              : status === 'mentioned' ? 'bg-yellow-500/30 border-yellow-500'
                              : status === 'competitor' ? 'bg-red-500/30 border-red-500'
                              : 'bg-muted/30 border-muted';
                      const icon = status === 'cited' ? '✓'
                              : status === 'mentioned' ? '~'
                              : status === 'competitor' ? `→${cell?.competitor?.slice(0, 12)}…`
                              : '—';
                      return (
                        <td key={p} className={`p-2 text-center border ${bg}`} title={cell?.excerpt}>
                          <span className="font-bold text-[11px]">{icon}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Insights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <InsightBlock
              title={`${data.guzelQueries.length} sorguda alıntılanıyorsun`}
              items={data.guzelQueries.slice(0, 3)}
              color="green"
            />
            <InsightBlock
              title={`${data.zayifQueries.length} sorguda rakip alıntılanıyor`}
              items={data.zayifQueries.slice(0, 3)}
              color="red"
            />
            <InsightBlock
              title={`${data.fırsatQueries.length} sorgu fırsat (kimse yok)`}
              items={data.fırsatQueries.slice(0, 3)}
              color="muted"
            />
          </div>

          {/* Rakip kazanmalari */}
          {Object.keys(data.competitorWins).length > 0 && (
            <div className="rounded-md border p-3 bg-red-500/5">
              <p className="text-xs font-semibold mb-2">🏆 Rakip Kazanma Sayıları</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.competitorWins).map(([host, wins]) => (
                  <Badge key={host} variant="outline" className="text-[11px]">
                    {host} · {wins as number} kez
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InsightBlock({ title, items, color }: { title: string; items: string[]; color: 'green' | 'red' | 'muted' }) {
  const bg = color === 'green' ? 'bg-green-500/10 border-green-500/30'
          : color === 'red' ? 'bg-red-500/10 border-red-500/30'
          : 'bg-muted/30 border-muted';
  return (
    <div className={`rounded-md border p-3 ${bg}`}>
      <p className="text-xs font-semibold mb-1.5">{title}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">—</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((q, i) => (
            <li key={i} className="text-[11px] truncate">• {q}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Wikidata
// ──────────────────────────────────────────────────────────────────
function WikidataTab({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getWikidataDraft(siteId);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Panoya kopyalandı');
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Wikidata = Google Knowledge Graph'in kaynağı. Markanızı Wikidata'ya eklerseniz AI'lar (özellikle Gemini ve Bard) sizi otomatik tanır. Aşağıdaki taslağı kopyalayın → "Wikidata'da Yeni Item" butonuna tıklayıp manuel girin.
      </p>
      {!data && (
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? 'Hazırlanıyor…' : '📝 Wikidata Taslağı Hazırla'}
        </Button>
      )}
      {data && (
        <div className="space-y-3">
          {/* Notability skoru */}
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">Notability Skoru</p>
              <span className={`text-2xl font-bold ${
                data.notabilityScore >= 60 ? 'text-green-500' :
                data.notabilityScore >= 40 ? 'text-yellow-500' : 'text-red-500'
              }`}>{data.notabilityScore}/100</span>
            </div>
            <ul className="space-y-1 text-xs">
              {data.notabilityNotes.map((n: string, i: number) => (
                <li key={i} className="flex items-start gap-1.5">
                  {n.startsWith('✓') ? <Check className="h-3 w-3 text-green-500 mt-0.5 shrink-0" /> :
                   n.startsWith('⚠') ? <AlertCircle className="h-3 w-3 text-yellow-500 mt-0.5 shrink-0" /> :
                   <X className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />}
                  <span>{n.replace(/^[✓⚠]\s*/, '')}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Labels */}
          <Field label="Türkçe Etiket" value={data.labels.tr.value} onCopy={copy} />
          <Field label="İngilizce Etiket" value={data.labels.en.value} onCopy={copy} />
          <Field label="Türkçe Açıklama" value={data.descriptions.tr.value} onCopy={copy} />

          {/* Claims tablosu */}
          <div className="rounded-md border">
            <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
              <p className="text-sm font-semibold">Claims (özellik → değer)</p>
              <button onClick={() => copy(JSON.stringify(data.claims, null, 2))} className="text-xs text-brand hover:underline inline-flex items-center gap-1">
                <Copy className="h-3 w-3" /> Tümünü Kopyala
              </button>
            </div>
            <div className="divide-y text-xs">
              {data.claims.map((c: any, i: number) => (
                <div key={i} className="px-3 py-2 flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-brand">{c.property}</span>
                    <span className="text-muted-foreground ml-1">{c.propertyLabel}</span>
                    <span className="ml-2 font-medium">{c.value}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{c.valueType}</Badge>
                </div>
              ))}
            </div>
          </div>

          <a href={data.createUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
            🌐 Wikidata'da Yeni Item Oluştur <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Wikipedia
// ──────────────────────────────────────────────────────────────────
function WikipediaTab({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getWikipediaDraft(siteId);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Panoya kopyalandı');
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Wikipedia = AI'ların eğitim verisinin <strong>%30+</strong>'ı. Wikipedia'da maddeniz olursa LLM'ler bir sonraki eğitiminde sizi öğrenir. Manuel review gerekir, "notability" eşiği yüksektir. Aşağıdaki taslağı kopyalayın → Wikipedia'ya gönderin.
      </p>
      {!data && (
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? 'AI hazırlıyor (Sonnet 4.6, ~30s)…' : '📝 Wikipedia Makale Taslağı Hazırla'}
        </Button>
      )}
      {data && (
        <div className="space-y-3">
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">{data.title}</p>
              <span className={`text-xl font-bold ${
                data.notabilityScore >= 60 ? 'text-green-500' : 'text-yellow-500'
              }`}>{data.notabilityScore}/100</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Notability skoru. 60+ değilse Wikipedia editörleri reddedebilir.</p>
          </div>

          <div className="rounded-md border">
            <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
              <p className="text-xs font-semibold">Wikitext (kopyala → Wikipedia editörüne yapıştır)</p>
              <button onClick={() => copy(data.content)} className="text-xs text-brand hover:underline inline-flex items-center gap-1">
                <Copy className="h-3 w-3" /> Kopyala
              </button>
            </div>
            <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap max-h-[400px] overflow-y-auto">{data.content}</pre>
          </div>

          <p className="text-[11px] text-muted-foreground">
            🔗 Kategoriler: {data.category.join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onCopy }: { label: string; value: string; onCopy: (text: string) => void }) {
  return (
    <div className="rounded-md border px-3 py-2 flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium min-w-[120px]">{label}</span>
      <span className="flex-1 text-sm">{value}</span>
      <button onClick={() => onCopy(value)} className="text-xs text-brand hover:underline">
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}
