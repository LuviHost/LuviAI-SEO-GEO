'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
import { PlanLockedCard } from '@/components/plan-locked-card';
import { cn } from '@/lib/utils';
import { CHART_SEMANTIC } from '@/lib/chart-colors';
import {
  Bot, RefreshCw, Check, X, ChevronDown, Copy, Wrench, Loader2,
  ShieldCheck, AlertTriangle, ListPlus,
} from 'lucide-react';

/**
 * Agent Readiness (AXO) — domain AI ajanlarina hazir mi?
 * 4 seviye, 15+ kontrol (sayi sonuctan dinamik), FETCH/PARSE/CONCLUDE audit detayi,
 * "Copy Agent Prompt" + tek tikla auto-fix (rakipte yok).
 */

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  ready:        { text: 'Hazır',          cls: 'text-emerald-500' },
  mostly_ready: { text: 'Çoğunlukla hazır', cls: 'text-green-500' },
  needs_work:   { text: 'Eksikler var',   cls: 'text-amber-500' },
  not_ready:    { text: 'Hazır değil',    cls: 'text-red-500' },
};

const IMPACT_BADGE: Record<string, { text: string; cls: string }> = {
  high:   { text: 'YÜKSEK ETKİ', cls: 'bg-red-500/10 text-red-600 border-red-500/30' },
  medium: { text: 'ORTA ETKİ',   cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  low:    { text: 'DÜŞÜK ETKİ',  cls: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30' },
  // Puansız bilgi kontrolü — skora girmez, ilk sürümde gözlem amaçlı
  info:   { text: 'BİLGİ',       cls: 'bg-sky-500/10 text-sky-600 border-sky-500/30' },
};

function Gauge({ score }: { score: number }) {
  // Yarim daire gauge — SVG arc
  const angle = Math.max(0, Math.min(100, score)) / 100 * 180;
  const rad = (a: number) => ((a - 180) * Math.PI) / 180;
  const x = 60 + 50 * Math.cos(rad(angle));
  const y = 60 + 50 * Math.sin(rad(angle));
  // NEDEN large-arc bayragi HEP 0: ray yarim daire, ilerleme yayi hicbir skorda 180°'yi
  // gecmez. Eski `angle > 90 ? 1 : 0` 50 ustu skorlarda tarayiciya "uzun yayi ciz" diyordu;
  // uzun yay obur merkezden 245° donup viewBox altindan kirpiliyor, ekranda yalniz iki uc
  // kaliyordu ("bar kaymis" — 02.09.2026, kobipratik skor 64). 50 altinda gorunmuyordu.
  const color = score >= 65 ? CHART_SEMANTIC.good : score >= 40 ? CHART_SEMANTIC.warn : CHART_SEMANTIC.crit;
  return (
    <svg viewBox="0 0 120 70" className="w-44">
      <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="10" strokeLinecap="round" />
      {score > 0 && (
        <path d={`M 10 60 A 50 50 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
      )}
      <text x="60" y="52" textAnchor="middle" className="fill-current" style={{ fontSize: 26, fontWeight: 700 }}>{score}</text>
      <text x="60" y="66" textAnchor="middle" className="fill-current opacity-50" style={{ fontSize: 8 }}>/ 100</text>
    </svg>
  );
}

export default function AgentReadinessPage() {
  const { site } = useSiteContext();
  const { can, requirementFor } = useEntitlements();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [openCheck, setOpenCheck] = useState<string | null>(null);

  const allowed = can('agentReadiness');

  const load = async () => {
    try {
      const res = await api.getAgentReadiness(site.id);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Haklar KESIN gelene kadar istek atilmaz — kapali planda bos 200/403 gurultusu olmasin.
  useEffect(() => {
    if (allowed !== true) return;
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [site.id, allowed]);

  const runScan = async () => {
    setRunning(true);
    try {
      const res = await api.runAgentReadiness(site.id);
      setData(res);
      toast.success(`Tarama tamamlandı — skor: ${res.overallScore}/100`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const applyFix = async (fixKey: string, checkName: string) => {
    setFixing(fixKey);
    try {
      const res = await api.applyAutoFix(site.id, [fixKey]);
      if (res?.applied?.length > 0) {
        toast.success(`${checkName} düzeltildi — yeniden taranıyor…`);
        await runScan();
      } else {
        const err = res?.errors?.[0]?.error ?? 'Dosya yazabilen bir yayın hedefi (SFTP/FTP/cPanel) gerekli';
        toast.error(err);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setFixing(null);
    }
  };

  const addToPlan = async (check: any) => {
    try {
      await api.addActionPlanItem(site.id, {
        title: check.name,
        description: check.howTo,
        source: 'agent_readiness',
        sourceRef: check.id,
        impact: check.impact === 'info' ? 'low' : check.impact,
      });
      toast.success('Aksiyon planına eklendi');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt).then(
      () => toast.success('Agent prompt kopyalandı'),
      () => toast.error('Kopyalanamadı'),
    );
  };

  if (allowed === false) {
    return (
      <PlanLockedCard
        requirement={requirementFor('agentReadiness')}
        description="Alan adının AI ajanlarına hazır olup olmadığını 4 seviyede ölçer, eksikleri tek tıkla düzeltir."
      />
    );
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground p-6 text-center">Agent Readiness yükleniyor…</div>;
  }

  const stance = data?.robotsAiStance;

  return (
    <div className="space-y-5">
      {/* Başlık */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 grid place-items-center">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Agent Readiness <span className="text-sm font-mono text-muted-foreground align-middle">AXO</span></h2>
            <p className="text-sm text-muted-foreground">
              Domain'in AI ajanlarına hazırlığı — 4 seviye, haftalık otomatik tarama. GEO "görünüyor musun" ölçer; bu ekran "ajanlar seni <em>kullanabiliyor mu</em>" ölçer.
            </p>
          </div>
        </div>
        <Button onClick={runScan} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          {running ? 'Taranıyor…' : 'Testleri Çalıştır'}
        </Button>
      </div>

      {!data ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <Bot className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Henüz tarama yok. İlk taramayı başlat — ~15 saniye sürer.</p>
            <Button onClick={runScan} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              İlk Taramayı Başlat
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Skor + stance özeti */}
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-8 flex-wrap">
                <div className="text-center">
                  <Gauge score={data.overallScore} />
                  <div className={cn('text-sm font-semibold mt-1', STATUS_LABEL[data.status]?.cls)}>
                    {STATUS_LABEL[data.status]?.text ?? data.status}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    Son tarama: {data.ranAt ? new Date(data.ranAt).toLocaleString('tr-TR') : '—'}
                  </div>
                  {(data.scoreVersion ?? 1) >= 2 && (
                    <div className="text-[10px] text-muted-foreground mt-0.5" title="Ağustos 2026: kullanıcı-tetikli botlar stance skorundan çıktı, llms.txt etkisi düşürüldü, bilgi kontrolleri eklendi. Önceki taramalarla puan farkı metodolojiden kaynaklanabilir.">
                      Metodoloji v2 · Ağu 2026
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-[260px] grid sm:grid-cols-2 gap-3">
                  {stance && (
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground mb-1">robots.txt AI duruşu</div>
                      <div className="text-sm font-semibold">
                        <span className="text-emerald-500">{stance.allow} allow</span>
                        <span className="text-muted-foreground mx-1.5">·</span>
                        <span className="text-red-500">{stance.block} block</span>
                        <span className="text-muted-foreground mx-1.5">·</span>
                        <span className="text-muted-foreground">{stance.unspecified} belirsiz</span>
                      </div>
                      {stance.scored && (
                        <div className="text-[10px] text-muted-foreground mt-1" title="ChatGPT-User, Perplexity-User, Claude-User gibi kullanıcı-tetikli fetcher'lar bir insanın AI sohbeti sırasında sayfayı canlı çeker ve robots.txt'e güvenilir uymaz — bu yüzden 'bilinçli duruş' skoruna katılmazlar.">
                          Skora giren: {stance.scored.named}/{stance.scored.total} eğitim + AI arama botu · kullanıcı-tetikli fetcher'lar skor dışı
                        </div>
                      )}
                    </div>
                  )}
                  {data.agentsAllowed !== null && (
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground mb-1">Ziyaret edebilen AI ajanı</div>
                      <div className="text-sm font-semibold">{data.agentsAllowed}/{data.agentsTotal}</div>
                    </div>
                  )}
                  {Array.isArray(data.nextUpToFix) && data.nextUpToFix.length > 0 && (
                    <div className="rounded-lg border p-3 sm:col-span-2">
                      <div className="text-xs text-muted-foreground mb-1.5">Sıradaki düzeltmeler</div>
                      <div className="flex flex-wrap gap-1.5">
                        {data.nextUpToFix.map((f: any) => (
                          <Badge key={f.checkId} variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                            <AlertTriangle className="h-3 w-3 mr-1" />{f.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Seviyeler */}
          {(data.levels ?? []).map((level: any) => (
            <Card key={level.id} className={cn(!level.applicable && 'opacity-60')}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-brand" />
                    <span className="font-semibold text-sm">{level.title}</span>
                    {!level.applicable && (
                      <Badge variant="outline" className="text-[10px]">Bu site için geçerli değil</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-28 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', level.score >= 80 ? 'bg-emerald-500' : level.score >= 50 ? 'bg-amber-500' : 'bg-red-500')}
                        style={{ width: `${level.score}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      {level.checks.filter((c: any) => c.ok).length}/{level.checks.length}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {level.checks.map((check: any) => {
                    const open = openCheck === check.id;
                    return (
                      <div key={check.id} className="rounded-lg border">
                        <button
                          type="button"
                          onClick={() => setOpenCheck(open ? null : check.id)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                        >
                          {check.ok
                            ? <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                            : <X className="h-4 w-4 text-red-500 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{check.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{check.statusText}</div>
                          </div>
                          <Badge variant="outline" className={cn('text-[9px] shrink-0', IMPACT_BADGE[check.impact]?.cls)}>
                            {IMPACT_BADGE[check.impact]?.text}
                          </Badge>
                          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform shrink-0', open && 'rotate-180')} />
                        </button>

                        {open && (
                          <div className="px-3 pb-3 space-y-3 border-t pt-3">
                            {/* Nasıl yapılır */}
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Nasıl düzeltilir</div>
                              <p className="text-xs leading-relaxed">{check.howTo}</p>
                            </div>

                            {/* Audit detayı — FETCH/PARSE/CONCLUDE */}
                            {Array.isArray(check.audit) && check.audit.length > 0 && (
                              <div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Denetim Detayı</div>
                                <div className="rounded-md bg-muted/40 divide-y divide-border/50">
                                  {check.audit.map((step: any, i: number) => (
                                    <div key={i} className="flex items-start gap-3 px-3 py-2">
                                      <span className="text-[10px] font-mono font-bold text-muted-foreground w-20 shrink-0 pt-0.5">{step.step}</span>
                                      <span className="text-xs font-mono flex-1 break-all">{step.detail}</span>
                                      {step.ok
                                        ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                                        : <X className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Aksiyonlar */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {!check.ok && check.fixKey && (
                                <Button size="sm" onClick={() => applyFix(check.fixKey, check.name)} disabled={fixing !== null}>
                                  {fixing === check.fixKey
                                    ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                    : <Wrench className="h-3.5 w-3.5 mr-1.5" />}
                                  Otomatik Düzelt
                                </Button>
                              )}
                              {check.agentPrompt && (
                                <Button size="sm" variant="outline" onClick={() => copyPrompt(check.agentPrompt)}>
                                  <Copy className="h-3.5 w-3.5 mr-1.5" /> Agent Prompt Kopyala
                                </Button>
                              )}
                              {!check.ok && (
                                <Button size="sm" variant="outline" onClick={() => addToPlan(check)}>
                                  <ListPlus className="h-3.5 w-3.5 mr-1.5" /> Aksiyon Planına Ekle
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
