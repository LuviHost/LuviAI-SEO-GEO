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
import { SectionHeader } from '@/components/ui/section-header';
import { SEVERITY_LABEL, label } from '@/lib/labels';
import { VendorLogo, type VendorName } from '@/components/vendor-logo';

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
  { id: 'google', label: 'Google Ads', icon: 'google', accent: 'sky' },
  { id: 'meta', label: 'Meta (Facebook + Instagram)', icon: 'facebook', accent: 'violet' },
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

// Onem rozetleri ui/badge ile ayni dil: durum token'i, cercevesiz
const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-danger/10 text-danger',
  high: 'bg-warning/10 text-warning',
  medium: 'bg-info/10 text-info',
  low: 'bg-muted text-muted-foreground',
};

const VERDICT_ICON: Record<string, React.ReactNode> = {
  pass: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />,
  warning: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />,
  fail: <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />,
  na: <span className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full bg-muted-foreground/20" />,
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
      <SectionHeader
        icon={Target}
        title="Kampanya Skoru"
        description="Google Ads ve Meta Ads hesabını 124 kontrol noktasında denetler; hızlı kazanımları tek tıkla uygularsın."
        actions={
          // Tarama yokken birincil eylem asagidaki bos durum dugmesi; ikinci turuncu olmasin
          <Button onClick={run} disabled={running} size="sm" variant={!loading && !audit ? 'outline' : 'default'}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${running ? 'animate-spin' : ''}`} />
            {running ? 'Taranıyor…' : audit ? 'Yeniden tara' : 'İlk taramayı başlat'}
          </Button>
        }
      />

      {/* Platform + industry seçicileri */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                  platform === p.id ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                )}
              >
                <VendorLogo name={p.icon as VendorName} size={16} alt="" /> {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="v-rail">Sektör:</span>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:border-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        // components/empty-state ile ayni gorunum (kesikli cerceve + notr ikon karosu)
        <div className="rounded-lg border border-dashed border-border">
          <div className="space-y-3 p-8 text-center sm:p-12">
            <div className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-md border text-foreground/70">
              <Target className="h-6 w-6" aria-hidden />
            </div>
            <p className="text-panel-2">Kampanya Skoru henüz hesaplanmadı</p>
            <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
              İlk taramada {platform === 'google' ? '74' : '50'} {platform === 'google' ? 'Google' : 'Meta'} Ads kontrol noktası analiz edilir
              (kurala dayalı kontroller ve AI değerlendirmesi). Ardından 15 dakikadan kısa sürede yapılabilecek kritik düzeltmeler listelenir.
              <br /><br />
              <em className="text-xs not-italic">Tarama 30–90 saniye sürebilir.</em>
            </p>
            <Button size="lg" onClick={run} disabled={running}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${running ? 'animate-spin' : ''}`} />
              {running ? 'Taranıyor…' : 'İlk Taramayı Başlat'}
            </Button>
          </div>
        </div>
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
                    <p className="v-rail">Kampanya Skoru</p>
                    <p className="mt-1 text-metric-lg tabular-nums">{audit.total}<span className="text-base tracking-normal text-muted-foreground">/100</span></p>
                    <p className="v-rail mt-1">
                      {audit.ranAt ? new Date(audit.ranAt).toLocaleString('tr-TR') : ''}
                    </p>
                  </div>
                </div>

                {/* Summary chips */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:col-span-2">
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
            <Card className="border-success/25 bg-success/5">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-success/30 text-success">
                    <Zap className="h-[18px] w-[18px]" aria-hidden />
                  </div>
                  <div>
                    <p className="text-panel-3">Hızlı kazanımlar</p>
                    <p className="text-sm text-muted-foreground">15 dakikadan kısa, yüksek etkili düzeltmeler</p>
                  </div>
                  <span className="ml-auto rounded bg-success/10 px-2 py-0.5 font-mono text-xs text-success">{quickWins.length}</span>
                </div>
                <ul className="space-y-2">
                  {quickWins.slice(0, 6).map((w: any) => (
                    <li key={w.ruleId} className="flex items-start gap-3 rounded-md border bg-card p-3">
                      <span className={cn('mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium', SEVERITY_STYLE[w.severity])}>
                        {label(SEVERITY_LABEL, w.severity)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{w.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{w.recommendation}</p>
                      </div>
                      <span className="v-rail mt-1 shrink-0">~{w.fixTimeMinutes}dk</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Kategori dağılımı */}
          <Card>
            <CardContent className="p-5">
              <p className="mb-3 inline-flex items-center gap-2 text-panel-3">
                <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden /> Kategori Dağılımı
              </p>
              <div className="space-y-2">
                {categories.map(([cat, c]) => {
                  const expanded = expandedCat === cat;
                  const items = groupedFindings[cat] ?? [];
                  const color = c.score >= 75 ? 'bg-success' : c.score >= 50 ? 'bg-warning' : 'bg-danger';
                  return (
                    <div key={cat} className="overflow-hidden rounded-md border">
                      <button
                        type="button"
                        onClick={() => setExpandedCat(expanded ? null : cat)}
                        className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50', expanded && 'bg-muted/50')}
                      >
                        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <span className="text-sm font-medium">{CATEGORY_LABELS[cat] ?? cat}</span>
                        <span className="v-rail hidden sm:inline">ağırlık %{(c.weight * 100).toFixed(0)}</span>
                        <div className="flex-1 max-w-xs ml-auto h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${color}`} style={{ width: `${c.score}%` }} />
                        </div>
                        <span className="w-10 text-right text-sm font-medium tabular-nums">{c.score}</span>
                      </button>
                      {expanded && (
                        <div className="divide-y border-t px-3 py-1">
                          {items.map((f) => (
                            <div key={f.ruleId} className="py-2.5">
                              <div className="flex items-start gap-2">
                                {VERDICT_ICON[f.verdict]}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="v-rail">{f.ruleId}</span>
                                    <p className="text-sm font-medium">{f.name}</p>
                                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', SEVERITY_STYLE[f.severity])}>{label(SEVERITY_LABEL, f.severity)}</span>
                                    {f.isQuickWin && (
                                      <span className="inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success">
                                        <Zap className="h-3 w-3" aria-hidden /> Hızlı kazanım
                                      </span>
                                    )}
                                  </div>
                                  {f.finding && <p className="text-xs text-muted-foreground mt-1">{f.finding}</p>}
                                  {f.recommendation && (
                                    <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
                                      <strong className="font-medium text-foreground">Aksiyon:</strong> {f.recommendation}
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
          { href: `/sites/${site.id}/ads`, label: 'Reklamlar', description: 'Kayıtlı kampanyalar, performans ve reklam otopilotu', icon: Megaphone },
          { href: `/sites/${site.id}/audit`, label: 'Site Skoru', description: '14 SEO + GEO kontrol noktası', icon: Award },
          { href: `/sites/${site.id}/connections`, label: 'Bağlantılar', description: 'Google Ads ve Meta hesabını bağla', icon: Settings },
          { href: `/sites/${site.id}/visibility`, label: 'AI Görünürlük', description: 'AI asistanlarında marka ve atıf takibi', icon: Sparkles },
        ]}
      />
    </div>
  );
}

function ScoreRing({ value, grade }: { value: number; grade: string }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  // Durum token'lari (globals.css): 75+ iyi, 40-74 dikkat, alti kotu — sabit renk kodu yok
  const color = value >= 75 ? 'hsl(var(--success))' : value >= 40 ? 'hsl(var(--warning))' : 'hsl(var(--danger))';
  return (
    <svg width="80" height="80" viewBox="0 0 80 80">
      <circle cx="40" cy="40" r={r} stroke="currentColor" strokeWidth="6" fill="none" className="text-muted" />
      <circle
        cx="40" cy="40" r={r}
        stroke={color} strokeWidth="6" fill="none"
        strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset}
        transform="rotate(-90 40 40)"
        style={{ transition: 'stroke-dashoffset 1s ease-out' }}
      />
      <text x="40" y="47" textAnchor="middle" className="font-medium" fontSize="22" fill={color}>{grade}</text>
    </svg>
  );
}

function SummaryChip({ label, value, accent }: { label: string; value: number; accent: 'emerald' | 'amber' | 'rose' | 'muted' }) {
  // ui/metric MetricCard ile ayni gorunum (mono etiket + ince rakam); durum yalniz rakamin renginde
  const styles = {
    emerald: 'text-success',
    amber: 'text-warning',
    rose: 'text-danger',
    muted: 'text-muted-foreground',
  };
  return (
    <div className="flex flex-col rounded-md border p-3">
      <div className="v-rail">{label}</div>
      <div className={cn('mt-2 text-metric-lg tabular-nums', styles[accent])}>{value}</div>
    </div>
  );
}
