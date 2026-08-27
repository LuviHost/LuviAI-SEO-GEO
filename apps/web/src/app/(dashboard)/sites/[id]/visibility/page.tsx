'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { CitationHistoryChart } from '@/components/citation-history-chart';
import { CrawlerHitsPanel } from '@/components/crawler-hits-panel';
import { Sparkles, Compass, Loader2, ChevronRight, FileText, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export default function VisibilityPage() {
  const { site } = useSiteContext();
  const [roadmapLoading, setRoadmapLoading] = useState(false);
  const [roadmap, setRoadmap] = useState<{
    summary: string;
    actions: Array<{ title: string; why: string; effort: 'low' | 'medium' | 'high' }>;
  } | null>(null);
  const [perPageLoading, setPerPageLoading] = useState(false);
  const [perPage, setPerPage] = useState<{
    pages: Array<{ url: string; cites: number; queries: Array<{ query: string; provider: string; cites: number }> }>;
    topPages: Array<{ url: string; cites: number }>;
    groundingQueries: Array<{ query: string; cites: number; pages: string[] }>;
    totalCites: number;
  } | null>(null);

  const runPerPage = async () => {
    setPerPageLoading(true);
    try {
      const r = await api.runCitationPerPage(site.id);
      setPerPage(r.breakdown);
      if (r.breakdown.totalCites === 0) {
        toast.message('Henüz cite alan sayfa yok — daha fazla içerik üret ve testi tekrarla');
      } else {
        toast.success(`${r.breakdown.totalCites} citation analiz edildi`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Per-page analiz başarısız');
    } finally {
      setPerPageLoading(false);
    }
  };

  const runRoadmap = async () => {
    setRoadmapLoading(true);
    try {
      const r = await api.runCitationRoadmap(site.id);
      if (r.roadmap) {
        setRoadmap(r.roadmap);
        toast.success('AI önerileri hazır');
      } else {
        toast.message('Yeterli veri yok — önce citation test çalıştır');
      }
    } catch (err: any) {
      toast.error(err.message || 'Roadmap üretilemedi');
    } finally {
      setRoadmapLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-orange-500/15 to-orange-600/10 text-orange-600 dark:text-orange-400 grid place-items-center ring-1 ring-orange-500/20">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">AI Görünürlük</h2>
          <p className="text-sm text-muted-foreground">Claude · Gemini · ChatGPT · Perplexity · Grok · DeepSeek · Meta'da marka takibi · sentiment · share of voice · rakip analizi.</p>
        </div>
      </div>

      <CitationHistoryChart siteId={site.id} siteName={site.name} siteUrl={site.url} />

      {/* GEO Roadmap — Maya tarzı öneri kutusu */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="p-5 border-b bg-gradient-to-br from-orange-500/5 to-transparent flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 text-white grid place-items-center shadow-lg shadow-orange-500/20">
              <Compass className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-bold">GEO Roadmap</h3>
              <p className="text-[11px] text-muted-foreground">AI mevcut sonuçlarını okur, ne yapman gerektiğini önerir.</p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={runRoadmap}
            disabled={roadmapLoading}
            className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white"
          >
            {roadmapLoading ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Analiz ediliyor</>
            ) : (
              <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> {roadmap ? 'Tekrar Üret' : 'AI Önerisi Al'}</>
            )}
          </Button>
        </div>

        {!roadmap && !roadmapLoading && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Compass className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
            <p>"AI Önerisi Al" butonuna bas — citation test çalıştırılır + 5 actionable öneri üretilir.</p>
          </div>
        )}

        {roadmap && (
          <div className="p-5 space-y-4">
            <div className="rounded-lg bg-muted/30 p-3 border-l-4 border-orange-500">
              <p className="text-sm font-medium">{roadmap.summary}</p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Eylem listesi</p>
              {roadmap.actions.map((a, i) => (
                <div key={i} className="rounded-lg border bg-background p-3 flex items-start gap-3 hover:border-orange-500/30 transition">
                  <div className="h-6 w-6 rounded-full bg-orange-500/15 text-orange-600 grid place-items-center text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-semibold">{a.title}</p>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        a.effort === 'low'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : a.effort === 'medium'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                            : 'bg-rose-500/15 text-rose-700 dark:text-rose-400'
                      }`}>
                        {a.effort === 'low' ? 'Kolay' : a.effort === 'medium' ? 'Orta' : 'Zor'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{a.why}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-1" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Per-Page Citations + Grounding Queries — Clarity tarzı */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="p-5 border-b bg-gradient-to-br from-purple-500/5 to-transparent flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 text-white grid place-items-center shadow-lg shadow-purple-500/20">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-bold">Per-Page Citations & Grounding Queries</h3>
              <p className="text-[11px] text-muted-foreground">Hangi sayfan hangi sorgu için AI cevabında alıntılandı?</p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={runPerPage}
            disabled={perPageLoading}
            className="bg-gradient-to-br from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white"
          >
            {perPageLoading ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Analiz ediliyor</>
            ) : (
              <><Search className="h-3.5 w-3.5 mr-1.5" /> {perPage ? 'Tekrar Çalıştır' : 'Analiz Et'}</>
            )}
          </Button>
        </div>

        {!perPage && !perPageLoading && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
            <p>"Analiz Et" → AI'larda sitenden hangi sayfaların alıntılandığı + hangi kullanıcı sorgusunun cite tetiklediği görünür.</p>
          </div>
        )}

        {perPage && perPage.totalCites === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
            <p>Henüz cite alan sayfa yok. AI cevabında URL'in geçmesi için: daha fazla makale, FAQ schema, llms.txt güncel tutulması yardımcı olur.</p>
          </div>
        )}

        {perPage && perPage.totalCites > 0 && (
          <div className="p-5 grid md:grid-cols-2 gap-5">
            {/* Top cited pages */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2.5">
                ⭐ En çok cite alan sayfalar
              </p>
              <div className="space-y-1.5">
                {perPage.topPages.map((p, i) => (
                  <div key={p.url} className="rounded-lg border bg-background p-2.5 flex items-center gap-3 hover:border-purple-500/30 transition">
                    <span className="h-6 w-6 rounded-full bg-purple-500/15 text-purple-700 dark:text-purple-400 grid place-items-center text-[10px] font-bold shrink-0">
                      {i + 1}
                    </span>
                    <code className="flex-1 text-xs font-mono truncate" title={p.url}>{p.url}</code>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold shrink-0">
                      {p.cites}× cite
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Grounding queries */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2.5">
                🎯 Cite tetikleyen sorgular
              </p>
              <div className="space-y-1.5">
                {perPage.groundingQueries.slice(0, 10).map((q, i) => (
                  <div key={i} className="rounded-lg border bg-background p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium flex-1 truncate">{q.query}</span>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] font-bold shrink-0">
                        {q.cites}×
                      </span>
                    </div>
                    {q.pages.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {q.pages.slice(0, 3).map((p) => (
                          <code key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[200px]" title={p}>{p}</code>
                        ))}
                        {q.pages.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{q.pages.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer stat */}
            <div className="md:col-span-2 mt-2 rounded-lg bg-muted/30 p-3 text-center text-xs">
              <strong className="text-base">{perPage.totalCites}</strong> toplam citation ·{' '}
              <strong>{perPage.pages.length}</strong> sayfa cite aldı ·{' '}
              <strong>{perPage.groundingQueries.length}</strong> farklı sorgu tetikledi
            </div>
          </div>
        )}
      </div>

      <CrawlerHitsPanel siteId={site.id} />
    </div>
  );
}
