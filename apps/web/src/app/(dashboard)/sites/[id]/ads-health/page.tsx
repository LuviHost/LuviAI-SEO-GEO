'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RelatedLinks } from '@/components/empty-state';
import {
  Target, RefreshCw, TrendingUp, AlertTriangle, CheckCircle2, XCircle,
  Zap, Sparkles, Megaphone, Settings, ChevronDown, ChevronRight, Award,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const INDUSTRIES = [
  { id: 'saas', label: 'SaaS' },
  { id: 'ecommerce', label: 'E-Ticaret' },
  { id: 'b2b', label: 'B2B' },
  { id: 'local', label: 'Yerel İşletme' },
  { id: 'healthcare', label: 'Sağlık' },
  { id: 'legal', label: 'Hukuk' },
  { id: 'finance', label: 'Finans' },
  { id: 'real_estate', label: 'Emlak' },
  { id: 'education', label: 'Eğitim' },
  { id: 'dental', label: 'Diş Sağlığı' },
  { id: 'restaurant', label: 'Restoran' },
  { id: 'travel', label: 'Seyahat' },
];

const PLATFORMS = [
  { id: 'google', label: 'Google Ads', icon: '🔵', accent: 'sky' },
  { id: 'meta', label: 'Meta (Facebook + Instagram)', icon: '🟣', accent: 'violet' },
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  conversion: 'Conversion Tracking',
  waste: 'Wasted Spend',
  structure: 'Hesap Yapısı',
  keywords: 'Keywords / QS',
  ads: 'Reklamlar & Asset',
  settings: 'Ayarlar / Hedefleme',
  pixel: 'Pixel / CAPI',
  creative: 'Creative',
  audience: 'Audience',
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
  high: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  medium: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30',
  low: 'bg-muted text-muted-foreground border-muted',
};

const VERDICT_ICON: Record<string, React.ReactNode> = {
  pass: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  fail: <XCircle className="h-4 w-4 text-rose-500" />,
  na: <span className="h-4 w-4 inline-block rounded-full bg-muted-foreground/20" />,
};

export default function AdsHealthPage() {
  const { site } = useSiteContext();
  const [platform, setPlatform] = useState<'google' | 'meta'>('google');
  const [industry, setIndustry] = useState<string>(() => {
    if (typeof window === 'undefined') return 'saas';
    return localStorage.getItem(`ads-audit-industry:${site.id}`) || 'saas';
  });
  const [audit, setAudit] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

  const load = async (p = platform) => {
    setLoading(true);
    try {
      const res = await api.getLatestAdsAudit(site.id, p);
      setAudit(res);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(platform); /* eslint-disable-next-line */ }, [platform, site.id]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`ads-audit-industry:${site.id}`, industry);
    }
  }, [industry, site.id]);

  const run = async () => {
    setRunning(true);
    try {
      const res = await api.runAdsAudit(site.id, platform, industry);
      setAudit({ ...res, ranAt: new Date().toISOString(), industry });
      toast.success(`Audit tamamlandı — Skor ${res.total}/100 (${res.grade})`);
    } catch (err: any) {
      toast.error(err.message || 'Audit başarısız');
    } finally {
      setRunning(false);
    }
  };

  const findings: any[] = audit?.findings ?? [];
  const quickWins: any[] = audit?.quickWins ?? [];
  const categories = Object.entries(audit?.byCategory ?? {}) as [string, { score: number; weight: number }][];
  const summary = audit?.summary ?? { pass: 0, warning: 0, fail: 0, na: 0, total: 0 };

  const groupedFindings: Record<string, any[]> = {};
  for (const f of findings) {
    if (f.verdict === 'na') continue;
    groupedFindings[f.category] = groupedFindings[f.category] ?? [];
    groupedFindings[f.category].push(f);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 grid place-items-center">
          <Target className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">Kampanya Skoru</h2>
          <p className="text-sm text-muted-foreground">
            <strong>124</strong> Google Ads + Meta Ads kontrol noktasından oluşan kapsamlı denetim. Quick Wins tek tıkla aksiyon.
          </p>
        </div>
        <Button onClick={run} disabled={running} variant="default" size="sm" className="shrink-0">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Taranıyor…' : audit ? 'Yeniden Tara' : 'İlk Tarama'}
        </Button>
      </div>

      {/* Platform + industry seçicileri */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-4">
          <div className="flex gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                className={cn(
                  'px-3 py-1.5 rounded-md border text-sm font-medium transition-colors',
                  platform === p.id ? 'bg-card border-brand text-brand' : 'border-muted text-muted-foreground hover:bg-muted/30',
                )}
              >
                {p.icon} {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground">Sektör:</span>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="rounded-md border bg-card px-2 py-1.5 text-sm"
            >
              {INDUSTRIES.map((i) => (
                <option key={i.id} value={i.id}>{i.label}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {loading && !audit && (
        <Card><CardContent className="p-5 space-y-3">
          <Skeleton className="h-32" /><Skeleton className="h-32" />
        </CardContent></Card>
      )}

      {!loading && !audit && (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <div className="h-14 w-14 mx-auto rounded-full bg-orange-500/10 grid place-items-center">
              <Target className="h-7 w-7 text-orange-600" />
            </div>
            <p className="font-semibold">Kampanya Skoru henüz hesaplanmadı</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              İlk taramada {platform === 'google' ? '74' : '50'} {platform === 'google' ? 'Google' : 'Meta'} Ads kontrol noktası analiz edilir
              (deterministik metrik kontrolü + AI judge ile yargı). Quick Wins (15 dk altı kritik aksiyonlar) listesi çıkar.
              <br /><br />
              <em className="text-xs">Snapshot taramaları 30-90 saniye sürebilir.</em>
            </p>
            <Button onClick={run} disabled={running}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${running ? 'animate-spin' : ''}`} />
              {running ? 'Taranıyor…' : 'İlk Taramayı Başlat'}
            </Button>
          </CardContent>
        </Card>
      )}

      {audit && (
        <>
          {/* Skor halkası + sub stats */}
          <Card>
            <CardContent className="p-5">
              <div className="grid md:grid-cols-3 gap-4 items-center">
                <div className="md:col-span-1 flex items-center gap-4">
                  <ScoreRing value={audit.total ?? 0} grade={audit.grade ?? 'F'} />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Kampanya Skoru</p>
                    <p className="text-3xl font-bold tabular-nums">{audit.total}<span className="text-base text-muted-foreground">/100</span></p>
                    <p className="text-xs text-muted-foreground">
                      {audit.ranAt ? new Date(audit.ranAt).toLocaleString('tr-TR') : ''}
                    </p>
                  </div>
                </div>

                {/* Summary chips */}
                <div className="md:col-span-2 grid grid-cols-4 gap-2">
                  <SummaryChip label="Geçti" value={summary.pass} accent="emerald" />
                  <SummaryChip label="Uyarı" value={summary.warning} accent="amber" />
                  <SummaryChip label="Kaldı" value={summary.fail} accent="rose" />
                  <SummaryChip label="Veri Yok" value={summary.na} accent="muted" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Wins kartı */}
          {quickWins.length > 0 && (
            <Card className="border-emerald-500/30 bg-emerald-500/[0.04]">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/15 text-emerald-600 grid place-items-center">
                    <Zap className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-emerald-700 dark:text-emerald-400">Quick Wins</p>
                    <p className="text-xs text-muted-foreground">15 dakikadan kısa, yüksek etkili düzeltmeler</p>
                  </div>
                  <span className="ml-auto text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700">{quickWins.length}</span>
                </div>
                <ul className="space-y-2">
                  {quickWins.slice(0, 6).map((w: any) => (
                    <li key={w.ruleId} className="flex items-start gap-3 p-2.5 rounded-md bg-card border">
                      <span className={cn('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 mt-0.5', SEVERITY_STYLE[w.severity])}>
                        {w.severity}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{w.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{w.recommendation}</p>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0 mt-1">~{w.fixTimeMinutes}dk</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Kategori dağılımı */}
          <Card>
            <CardContent className="p-5">
              <p className="font-semibold mb-3 inline-flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-brand" /> Kategori Dağılımı
              </p>
              <div className="space-y-2">
                {categories.map(([cat, c]) => {
                  const expanded = expandedCat === cat;
                  const items = groupedFindings[cat] ?? [];
                  const color = c.score >= 75 ? 'bg-emerald-500' : c.score >= 50 ? 'bg-amber-500' : 'bg-rose-500';
                  return (
                    <div key={cat} className="rounded-lg border overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedCat(expanded ? null : cat)}
                        className={cn('w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/30 transition-colors', expanded && 'bg-muted/30')}
                      >
                        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <span className="text-sm font-medium">{CATEGORY_LABELS[cat] ?? cat}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">ağırlık %{(c.weight * 100).toFixed(0)}</span>
                        <div className="flex-1 max-w-xs ml-auto h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${color}`} style={{ width: `${c.score}%` }} />
                        </div>
                        <span className="text-sm font-bold tabular-nums w-12 text-right">{c.score}</span>
                      </button>
                      {expanded && (
                        <div className="px-3 py-2 bg-card divide-y">
                          {items.map((f) => (
                            <div key={f.ruleId} className="py-2.5">
                              <div className="flex items-start gap-2">
                                {VERDICT_ICON[f.verdict]}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] font-mono text-muted-foreground">{f.ruleId}</span>
                                    <p className="text-sm font-medium">{f.name}</p>
                                    <span className={cn('text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border', SEVERITY_STYLE[f.severity])}>{f.severity}</span>
                                    {f.isQuickWin && (
                                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 inline-flex items-center gap-0.5">
                                        <Zap className="h-2.5 w-2.5" /> QUICK WIN
                                      </span>
                                    )}
                                  </div>
                                  {f.finding && <p className="text-xs text-muted-foreground mt-1">{f.finding}</p>}
                                  {f.recommendation && (
                                    <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
                                      <strong className="text-brand">Aksiyon:</strong> {f.recommendation}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                          {items.length === 0 && (
                            <p className="py-3 text-sm text-muted-foreground text-center">Bu kategoride bulgu yok.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <RelatedLinks
        links={[
          { href: `/sites/${site.id}/ads`, label: 'Reklamlar', description: 'Kampanya yönetimi + creative üretici', icon: Megaphone },
          { href: `/sites/${site.id}/audit`, label: 'Site Skoru', description: '14 SEO + GEO kontrol noktası', icon: Award },
          { href: `/sites/${site.id}/connections`, label: 'Bağlantılar', description: 'Google Ads + Meta token kurulumu', icon: Settings },
          { href: `/sites/${site.id}/visibility`, label: 'AI Görünürlük', description: 'ChatGPT/Claude/Gemini citation tracking', icon: Sparkles },
        ]}
      />
    </div>
  );
}

function ScoreRing({ value, grade }: { value: number; grade: string }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  const color = value >= 90 ? '#10b981' : value >= 75 ? '#84cc16' : value >= 60 ? '#f59e0b' : value >= 40 ? '#fb923c' : '#f43f5e';
  return (
    <svg width="80" height="80" viewBox="0 0 80 80">
      <circle cx="40" cy="40" r={r} stroke="currentColor" strokeWidth="6" fill="none" className="text-muted/30" />
      <circle
        cx="40" cy="40" r={r}
        stroke={color} strokeWidth="6" fill="none"
        strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset}
        transform="rotate(-90 40 40)"
        style={{ transition: 'stroke-dashoffset 1s ease-out' }}
      />
      <text x="40" y="46" textAnchor="middle" className="font-bold" fontSize="22" fill={color}>{grade}</text>
    </svg>
  );
}

function SummaryChip({ label, value, accent }: { label: string; value: number; accent: 'emerald' | 'amber' | 'rose' | 'muted' }) {
  const styles = {
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
    rose: 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400',
    muted: 'border-muted bg-muted/30 text-muted-foreground',
  };
  return (
    <div className={cn('rounded-lg border px-3 py-2.5', styles[accent])}>
      <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">{label}</div>
      <div className="text-2xl font-bold tabular-nums leading-tight mt-0.5">{value}</div>
    </div>
  );
}
