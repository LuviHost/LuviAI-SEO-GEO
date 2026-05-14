'use client';

import { use, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Award, TrendingUp, TrendingDown, Search, Plus, RefreshCw, Star, Users, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface ScoreResult {
  appId: string;
  appName: string;
  computedAt: string;
  overall_score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  breakdown: Record<string, { score: number; weight: number; weighted_contribution: number }>;
  recommendations: Array<{ category: string; priority: 'high' | 'medium' | 'low'; action: string; details: string; expected_impact: string }>;
  strengths: string[];
  weaknesses: string[];
}

const GRADE_COLOR: Record<string, string> = {
  A: 'text-emerald-600 dark:text-emerald-400',
  B: 'text-blue-600 dark:text-blue-400',
  C: 'text-amber-600 dark:text-amber-400',
  D: 'text-orange-600 dark:text-orange-400',
  F: 'text-rose-600 dark:text-rose-400',
};

const PRIORITY_BADGE: Record<string, string> = {
  high:   'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  low:    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const CATEGORY_LABEL: Record<string, string> = {
  metadata_quality:    'Metadata Kalitesi',
  ratings_reviews:     'Puan ve Yorumlar',
  keyword_performance: 'Keyword Performansı',
  conversion_metrics:  'Conversion Metrikleri',
};

function ScoreGauge({ score, grade }: { score: number; grade: string }) {
  const circumference = 2 * Math.PI * 70;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative w-44 h-44 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r="70" fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/30" />
        <circle
          cx="80" cy="80" r="70" fill="none"
          stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
        />
      </svg>
      <div className="text-center">
        <div className="text-4xl font-bold">{Math.round(score)}</div>
        <div className={`text-2xl font-bold ${GRADE_COLOR[grade]}`}>{grade}</div>
      </div>
    </div>
  );
}

export default function AsoHealthPage({ params }: { params: Promise<{ id: string; appId: string }> }) {
  const { id: siteId, appId } = use(params);
  const router = useRouter();

  // Score state
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);
  const [scoring, setScoring] = useState(false);
  const [targetKeywords, setTargetKeywords] = useState<string>('');

  // Competitors state
  const [category, setCategory] = useState('productivity');
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [loadingComp, setLoadingComp] = useState(false);

  // Initial: bir defa score hesapla
  useEffect(() => {
    runScore();
  }, [appId]);

  const runScore = async () => {
    setScoring(true);
    try {
      const keywords = targetKeywords.split(',').map(k => k.trim()).filter(Boolean);
      const result = await api.asoCalculateScore(siteId, appId, {
        targetKeywords: keywords,
      });
      setScoreResult(result);
    } catch (err: any) {
      toast.error(`Skor hesaplanamadı: ${err.message}`);
    } finally {
      setScoring(false);
    }
  };

  const loadCompetitors = async () => {
    if (!category.trim()) return;
    setLoadingComp(true);
    try {
      const res = await api.asoListCompetitors(siteId, category.trim(), 'tr', 10);
      setCompetitors(res.results ?? []);
      if ((res.results ?? []).length === 0) toast.info('Bu kategoride sonuç bulunamadı');
    } catch (err: any) {
      toast.error(`Rakipler getirilemedi: ${err.message}`);
    } finally {
      setLoadingComp(false);
    }
  };

  return (
    <div className="p-6 max-w-[1500px] mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => router.push(`/sites/${siteId}/aso/${appId}`)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> ASO
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Award className="h-6 w-6" /> ASO Health</h1>
            <p className="text-sm text-muted-foreground">4-boyut weighted skor + rakip kıyaslama</p>
          </div>
        </div>
        <Button onClick={runScore} disabled={scoring}>
          <RefreshCw className={`h-4 w-4 mr-1 ${scoring ? 'animate-spin' : ''}`} />
          {scoring ? 'Hesaplanıyor...' : 'Skoru yenile'}
        </Button>
      </div>

      {/* Score panel */}
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6 items-start">
            {scoring && !scoreResult ? (
              <Skeleton className="h-44 w-44 rounded-full" />
            ) : scoreResult ? (
              <ScoreGauge score={scoreResult.overall_score} grade={scoreResult.grade} />
            ) : (
              <div className="h-44 w-44 grid place-items-center text-sm text-muted-foreground border-2 border-dashed rounded-full">
                Henüz hesaplanmadı
              </div>
            )}

            <div className="space-y-4 w-full">
              <div>
                <label className="text-xs font-medium block mb-1">Hedef anahtar kelimeler (virgülle ayır)</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="örn: todo list, productivity, task manager"
                    value={targetKeywords}
                    onChange={e => setTargetKeywords(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && runScore()}
                    className="flex-1"
                  />
                  <Button onClick={runScore} disabled={scoring}>Yeniden hesapla</Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Title ve description'da bu keyword'lerin geçişine göre metadata skoru hesaplanır.
                </p>
              </div>

              {scoreResult && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(scoreResult.breakdown).map(([k, v]) => (
                    <div key={k} className="rounded-md border p-3">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                        {CATEGORY_LABEL[k] ?? k}
                      </div>
                      <div className="text-2xl font-bold">{v.score}</div>
                      <div className="text-[10px] text-muted-foreground">
                        ağırlık %{v.weight} · katkı {v.weighted_contribution}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strengths / Weaknesses */}
      {scoreResult && (scoreResult.strengths.length > 0 || scoreResult.weaknesses.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {scoreResult.strengths.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-2 flex items-center gap-2 text-emerald-600">
                  <TrendingUp className="h-4 w-4" /> Güçlü Yönler
                </h3>
                <ul className="text-sm space-y-1">
                  {scoreResult.strengths.map((s, i) => <li key={i}>• {s}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}
          {scoreResult.weaknesses.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-2 flex items-center gap-2 text-rose-600">
                  <TrendingDown className="h-4 w-4" /> Zayıf Yönler
                </h3>
                <ul className="text-sm space-y-1">
                  {scoreResult.weaknesses.map((w, i) => <li key={i}>• {w}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Recommendations */}
      {scoreResult && scoreResult.recommendations.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3">Öneriler ({scoreResult.recommendations.length})</h3>
            <div className="space-y-3">
              {scoreResult.recommendations.map((r, i) => (
                <div key={i} className="border-l-4 border-brand pl-3 py-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${PRIORITY_BADGE[r.priority]}`}>
                      {r.priority}
                    </span>
                    <span className="text-xs text-muted-foreground">{CATEGORY_LABEL[r.category] ?? r.category}</span>
                  </div>
                  <div className="font-medium text-sm">{r.action}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{r.details}</div>
                  <div className="text-xs italic text-emerald-600 mt-1">→ {r.expected_impact}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Competitor section */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h2 className="font-bold flex items-center gap-2"><Users className="h-5 w-5" /> Rakip Analizi</h2>
            <div className="flex gap-2">
              <Input
                placeholder="Kategori (örn: productivity, fitness, finance)"
                value={category}
                onChange={e => setCategory(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadCompetitors()}
                className="w-72"
              />
              <Button onClick={loadCompetitors} disabled={loadingComp}>
                <Search className="h-4 w-4 mr-1" />
                {loadingComp ? 'Aranıyor...' : 'Bul'}
              </Button>
            </div>
          </div>

          {loadingComp ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : competitors.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
              Kategori yaz ve "Bul" tıkla — iTunes Search API üzerinden çekilir.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2">App</th>
                    <th className="text-left py-2 hidden md:table-cell">Developer</th>
                    <th className="text-center py-2">Rating</th>
                    <th className="text-right py-2 hidden lg:table-cell">Reviews</th>
                    <th className="text-center py-2 hidden sm:table-cell">Price</th>
                    <th className="text-right py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {competitors.map((c, i) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          {c.icon_url && <img src={c.icon_url} alt="" className="w-8 h-8 rounded shrink-0" />}
                          <div className="min-w-0">
                            <div className="font-medium truncate">{c.app_name ?? '—'}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{c.category}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 hidden md:table-cell text-xs text-muted-foreground">{c.developer ?? '—'}</td>
                      <td className="py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          <span>{(c.rating ?? 0).toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="py-2 text-right hidden lg:table-cell text-xs">
                        {(c.ratings_count ?? 0).toLocaleString('tr-TR')}
                      </td>
                      <td className="py-2 text-center hidden sm:table-cell text-xs">{c.price ?? 'Free'}</td>
                      <td className="py-2 text-right">
                        {c.app_store_url && (
                          <a href={c.app_store_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline">
                            App Store ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
