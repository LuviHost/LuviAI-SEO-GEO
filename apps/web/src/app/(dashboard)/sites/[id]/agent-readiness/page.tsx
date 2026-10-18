'use client';

import { useCallback, useEffect, useState } from 'react';
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
  ShieldCheck, ShieldAlert, AlertTriangle, ListPlus, Info,
} from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';
import { AutoFixPreviewDialog } from './auto-fix-preview-dialog';
import { AutoFixHistory } from './auto-fix-history';

/**
 * Agent Readiness (AXO) — domain AI ajanlarına hazır mı?
 * 4 seviye, kontrol sayısı sonuçtan dinamik, FETCH/PARSE/CONCLUDE denetim detayı,
 * "Copy Agent Prompt" ve önizlemeli kök dosya düzeltmesi (robots.txt / sitemap.xml / llms.txt).
 *
 * Metodoloji v3: erişim engeli "eksik" sayılmaz (puana girmez); API/ajan
 * arayüzüne bağlı kontroller yalnız site o arayüzü sunuyorsa puanlanır.
 */

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  ready:        { text: 'Hazır',            cls: 'text-success' },
  mostly_ready: { text: 'Çoğunlukla hazır', cls: 'text-success' },
  needs_work:   { text: 'Eksikler var',     cls: 'text-warning' },
  not_ready:    { text: 'Hazır değil',      cls: 'text-danger' },
  blocked:      { text: 'Erişim engellendi', cls: 'text-warning' },
  unreachable:  { text: 'Siteye ulaşılamadı', cls: 'text-warning' },
};

const IMPACT_BADGE: Record<string, { text: string; cls: string }> = {
  high:   { text: 'YÜKSEK ETKİ', cls: 'bg-danger/10 text-danger border-danger/30' },
  medium: { text: 'ORTA ETKİ',   cls: 'bg-warning/10 text-warning border-warning/30' },
  low:    { text: 'DÜŞÜK ETKİ',  cls: 'bg-muted text-muted-foreground border-border' },
  // Puansız bilgi kontrolü — skora girmez
  info:   { text: 'BİLGİ',       cls: 'bg-info/10 text-info border-info/30' },
};

/** Metodoloji rozetleri — skor sürümü değiştikçe önceki taramalarla puan farkı açıklanır */
const METHOD_LABEL: Record<number, { text: string; title: string }> = {
  2: {
    text: 'Metodoloji v2 · Ağu 2026',
    title: 'Ağustos 2026: kullanıcı-tetikli botlar stance skorundan çıktı, llms.txt etkisi düşürüldü, bilgi kontrolleri eklendi.',
  },
  3: {
    text: 'Metodoloji v3 · Eki 2026',
    title: 'Ekim 2026: erişim engeli (güvenlik duvarı, bot doğrulaması, 429/503) artık "eksik" sayılmıyor ve puana girmiyor; HTML dönen sahte dosyalar (soft-404) geçerli sayılmıyor; auth.md, API kataloğu, A2A ve MCP kontrolleri yalnız site o arayüzü sunuyorsa puanlanıyor; llms-full.txt canlı siteden ölçülüyor; ürün feed\'i yalnız gerçekten okunup doğrulandığında puanlanıyor, Product schema site haritasından örneklenen ürün sayfalarında ölçülüyor; agentic checkout ve işletilebilirlik sinyalleri bilgi amaçlı.',
  },
};

type CheckState = 'pass' | 'fail' | 'blocked' | 'info';

/** v2 kayıtlarında state alanı yok — aynı kuralla türet */
function stateOf(check: any): CheckState {
  if (check.state) return check.state;
  if (check.blocked) return 'blocked';
  if (check.impact === 'info') return 'info';
  return check.ok ? 'pass' : 'fail';
}

function StateIcon({ state, ok }: { state: CheckState; ok: boolean }) {
  if (state === 'pass') return <Check className="h-4 w-4 text-success shrink-0" aria-label="Geçti" />;
  if (state === 'fail') return <X className="h-4 w-4 text-danger shrink-0" aria-label="Eksik" />;
  if (state === 'blocked') return <ShieldAlert className="h-4 w-4 text-warning shrink-0" aria-label="Ölçülemedi" />;
  return ok
    ? <Check className="h-4 w-4 text-muted-foreground shrink-0" aria-label="Bilgi: var" />
    : <Info className="h-4 w-4 text-muted-foreground shrink-0" aria-label="Bilgi" />;
}

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
  const [previewFix, setPreviewFix] = useState<{ key: string; name: string } | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [openCheck, setOpenCheck] = useState<string | null>(null);

  const allowed = can('agentReadiness');

  const load = useCallback(async () => {
    try {
      const res = await api.getAgentReadiness(site.id);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [site.id]);

  // Haklar KESIN gelene kadar istek atilmaz — kapali planda bos 200/403 gurultusu olmasin.
  useEffect(() => {
    if (allowed !== true) return;
    load();
  }, [allowed, load]);

  const runScan = async () => {
    setRunning(true);
    try {
      const res = await api.runAgentReadiness(site.id);
      // Kaydedilen taramayla ayni alanlar (onceki surum bilgisi dahil) icin yeniden oku
      setData({ ...res, prevScoreVersion: data?.scoreVersion ?? null });
      // Engelli/ulasilamaz taramada API skoru null + measured:false doner — "null/100" gosterme
      if (res.access || res.measured === false || res.overallScore == null) {
        toast.warning(`Tarama tamamlandı ama ölçüm eksik: ${res.access?.reason ?? 'siteye erişilemedi'}`, { duration: 9000 });
      } else {
        toast.success(`Tarama tamamlandı — skor: ${res.overallScore}/100`);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const addToPlan = async (check: any) => {
    try {
      await api.addActionPlanItem(site.id, {
        title: check.name,
        description: check.blocked ? `${check.blocked.reason} ${check.blocked.hint}` : check.howTo,
        source: 'agent_readiness',
        sourceRef: check.id,
        impact: check.impact === 'info' ? 'low' : check.impact,
      });
      toast.success('Aksiyon planına eklendi');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const copyText = (text: string, done: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(done),
      () => toast.error('Kopyalanamadı'),
    );
  };

  if (allowed === false) {
    return (
      <PlanLockedCard
        requirement={requirementFor('agentReadiness')}
        description="Alan adının AI ajanlarına hazır olup olmadığını 4 seviyede ölçer; robots.txt, site haritası ve llms.txt eksiklerini önizleyip onayınla düzeltir."
      />
    );
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground p-6 text-center">Agent Readiness yükleniyor…</div>;
  }

  const stance = data?.robotsAiStance;
  const access = data?.access ?? null;
  const unmeasured = data?.status === 'blocked' || data?.status === 'unreachable' || data?.measured === false;
  const method = METHOD_LABEL[data?.scoreVersion ?? 0];
  const methodChanged = data?.prevScoreVersion != null && data?.scoreVersion != null && data.prevScoreVersion !== data.scoreVersion;

  return (
    <div className="space-y-5">
      {/* Başlık */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <SectionHeader
          icon={Bot}
          title="Ajan Hazırlığı"
          description={<>AI ajanları siteni kullanabiliyor mu? 4 seviyede, haftada bir otomatik test edilir. GEO görünürlüğü ölçer; bu ekran ajanların sitende iş yapabilmesini ölçer.</>}
        />
        <Button onClick={runScan} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          {running ? 'Taranıyor…' : 'Testleri Çalıştır'}
        </Button>
      </div>

      {!data ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <Bot className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Henüz tarama yok. İlk taramayı başlat — genellikle yarım dakikadan kısa sürer.</p>
            <Button onClick={runScan} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              İlk Taramayı Başlat
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Erişim engeli — skor yerine neden ve çözüm */}
          {unmeasured && (
            <Card className="border-warning/40">
              <CardContent className="p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-warning" />
                  <span className="font-semibold">{data.status === 'blocked' ? 'Sitene erişimimiz engellendi' : 'Sitene ulaşılamadı'}</span>
                </div>
                {access?.reason && <p className="text-sm">{access.reason}</p>}
                {access?.hint && <p className="text-sm text-muted-foreground">{access.hint}</p>}
                <p className="text-xs text-muted-foreground">
                  Bu yüzden skor gösterilmiyor: ölçülen şey sitenin kendisi değil, erişimimiz. Engellenen kontroller puana girmedi; ölçülebilenler aşağıda. İzin verdikten sonra testleri yeniden çalıştır.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Skor + stance özeti */}
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-8 flex-wrap">
                <div className="text-center">
                  {unmeasured ? (
                    <div className="w-44 py-6 text-center">
                      <ShieldAlert className="h-10 w-10 mx-auto text-warning/70" />
                      <div className="text-label text-muted-foreground mt-2">Skor yok — ölçülemedi</div>
                    </div>
                  ) : (
                    <Gauge score={data.overallScore} />
                  )}
                  <div className={cn('text-sm font-semibold mt-1', STATUS_LABEL[data.status]?.cls)}>
                    {STATUS_LABEL[data.status]?.text ?? data.status}
                  </div>
                  <div className="text-label text-muted-foreground mt-0.5">
                    Son tarama: {data.ranAt ? new Date(data.ranAt).toLocaleString('tr-TR') : '—'}
                  </div>
                  {method && (
                    <div className="text-label text-muted-foreground mt-0.5" title={method.title}>
                      {method.text}
                    </div>
                  )}
                  {methodChanged && (
                    <div className="text-label text-warning mt-0.5 max-w-[11rem] mx-auto" title={method?.title}>
                      Önceki tarama v{data.prevScoreVersion} metodolojisiyle yapıldı; puan farkı metodolojiden kaynaklanabilir.
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-[260px] grid sm:grid-cols-2 gap-3">
                  {stance && (
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground mb-1">robots.txt AI duruşu</div>
                      <div className="text-sm font-semibold">
                        <span className="text-success">{stance.allow} izinli</span>
                        <span className="text-muted-foreground mx-1.5">·</span>
                        <span className="text-danger">{stance.block} engelli</span>
                        <span className="text-muted-foreground mx-1.5">·</span>
                        <span className="text-muted-foreground">{stance.unspecified} kural yok</span>
                      </div>
                      {stance.scored && (
                        <div className="text-label text-muted-foreground mt-1" title="ChatGPT-User, Perplexity-User, Claude-User gibi kullanıcı-tetikli fetcher'lar bir insanın AI sohbeti sırasında sayfayı canlı çeker ve robots.txt'e güvenilir uymaz — bu yüzden 'bilinçli duruş' skoruna katılmazlar.">
                          Skora giren: {stance.scored.named}/{stance.scored.total} eğitim + AI arama botu · kullanıcı-tetikli fetcher&apos;lar skor dışı
                        </div>
                      )}
                    </div>
                  )}
                  {data.agentsAllowed !== null && data.agentsAllowed !== undefined && (
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
                          <Badge key={f.checkId} variant="warning">
                            <AlertTriangle className="h-3 w-3 mr-1" />{f.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="rounded-lg border p-3 sm:col-span-2 text-xs text-muted-foreground flex items-start gap-2">
                    <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
                    <span>
                      auth.md, API kataloğu, A2A ajan kartı ve MCP sunucu kartı yalnız sitende o arayüz varsa puanlanır; yoksa &quot;BİLGİ&quot; olarak gösterilir ve skoru düşürmez.
                      {data.scoring?.blockedChecks > 0 && ` ${data.scoring.blockedChecks} kontrol erişim engeli nedeniyle ölçülemedi ve puana girmedi.`}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Seviyeler */}
          {(data.levels ?? []).map((level: any) => {
            const checks: any[] = level.checks ?? [];
            const scored = level.scoredChecks ?? checks.filter((c) => ['pass', 'fail'].includes(stateOf(c))).length;
            const passed = level.passedChecks ?? checks.filter((c) => stateOf(c) === 'pass').length;
            const blockedCount = level.blockedChecks ?? checks.filter((c) => stateOf(c) === 'blocked').length;
            return (
              <Card key={level.id} className={cn(!level.applicable && 'opacity-60')}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">{level.title}</span>
                      {!level.applicable && (
                        <Badge variant="outline" className="text-label">Bu site için geçerli değil</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {scored > 0 && (
                        <div className="h-1.5 w-28 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', level.score >= 80 ? 'bg-success' : level.score >= 50 ? 'bg-warning' : 'bg-danger')}
                            style={{ width: `${level.score}%` }}
                          />
                        </div>
                      )}
                      <span className="text-xs font-mono text-muted-foreground" title="Geçen / puanlanan kontrol (bilgi ve ölçülemeyen kontroller hariç)">
                        {scored > 0 ? `${passed}/${scored}` : 'puansız'}
                        {blockedCount > 0 && ` · ${blockedCount} ölçülemedi`}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {checks.map((check: any) => {
                      const open = openCheck === check.id;
                      const state = stateOf(check);
                      return (
                        <div key={check.id} className="rounded-lg border">
                          <button
                            type="button"
                            onClick={() => setOpenCheck(open ? null : check.id)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                            aria-expanded={open}
                          >
                            <StateIcon state={state} ok={!!check.ok} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium">{check.name}</div>
                              <div className="text-xs text-muted-foreground truncate">{check.statusText}</div>
                            </div>
                            {state === 'blocked' ? (
                              <Badge variant="outline" className="text-label shrink-0 bg-warning/10 text-warning border-warning/30">ÖLÇÜLEMEDİ</Badge>
                            ) : (
                              <Badge variant="outline" className={cn('text-label shrink-0', IMPACT_BADGE[check.impact]?.cls)}>
                                {IMPACT_BADGE[check.impact]?.text}
                              </Badge>
                            )}
                            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform shrink-0', open && 'rotate-180')} />
                          </button>

                          {open && (
                            <div className="px-3 pb-3 space-y-3 border-t pt-3">
                              {/* Erişim engeli — engeli aşmayı değil izin vermeyi anlatır */}
                              {check.blocked && (
                                <div className="rounded-md border border-warning/30 bg-warning/5 p-3 space-y-1">
                                  <div className="text-xs font-medium flex items-center gap-1.5">
                                    <ShieldAlert className="h-3.5 w-3.5 text-warning" aria-hidden /> Ölçülemedi — puana girmedi
                                  </div>
                                  <p className="text-xs">{check.blocked.reason}</p>
                                  {check.blocked.hint && <p className="text-xs text-muted-foreground">{check.blocked.hint}</p>}
                                </div>
                              )}

                              {check.scoreNote && (
                                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                                  <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden /> {check.scoreNote}
                                </p>
                              )}

                              {/* Nasıl yapılır */}
                              <div>
                                <div className="text-label font-medium text-muted-foreground mb-1">Nasıl düzeltilir</div>
                                <p className="text-xs leading-relaxed">{check.howTo}</p>
                              </div>

                              {/* Elle kullanım şablonu (auth.md) — her bilinmeyen değer yer tutucu */}
                              {check.manualTemplate && (
                                <div className="space-y-1.5">
                                  <div className="text-label font-medium text-muted-foreground">Elle kullanım şablonu ({check.manualTemplate.filename})</div>
                                  <p className="text-xs text-muted-foreground">{check.manualTemplate.note}</p>
                                  <pre className="rounded-md bg-muted/40 p-3 text-xs font-mono max-h-56 overflow-auto whitespace-pre-wrap">{check.manualTemplate.content}</pre>
                                </div>
                              )}

                              {/* Denetim detayı — FETCH/PARSE/CONCLUDE */}
                              {Array.isArray(check.audit) && check.audit.length > 0 && (
                                <div>
                                  <div className="text-label font-medium text-muted-foreground mb-1">Denetim Detayı</div>
                                  <div className="rounded-md bg-muted/40 divide-y divide-border/50">
                                    {check.audit.map((step: any, i: number) => (
                                      <div key={i} className="flex items-start gap-3 px-3 py-2">
                                        <span className="text-label font-mono font-bold text-muted-foreground w-20 shrink-0 pt-0.5">{step.step}</span>
                                        <span className="text-xs font-mono flex-1 break-all">{step.detail}</span>
                                        {step.ok
                                          ? <Check className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                                          : <X className="h-3.5 w-3.5 text-danger shrink-0 mt-0.5" />}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Aksiyonlar */}
                              <div className="flex items-center gap-2 flex-wrap">
                                {state === 'fail' && check.fixKey && (
                                  <Button size="sm" onClick={() => setPreviewFix({ key: check.fixKey, name: check.name })} disabled={previewFix !== null}>
                                    <Wrench className="h-3.5 w-3.5 mr-1.5" /> Önizle ve uygula
                                  </Button>
                                )}
                                {check.manualTemplate && (
                                  <Button size="sm" variant="outline" onClick={() => copyText(check.manualTemplate.content, 'Şablon kopyalandı')}>
                                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Şablonu kopyala
                                  </Button>
                                )}
                                {check.agentPrompt && (
                                  <Button size="sm" variant="outline" onClick={() => copyText(check.agentPrompt, 'Agent prompt kopyalandı')}>
                                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Agent Prompt Kopyala
                                  </Button>
                                )}
                                {(state === 'fail' || state === 'blocked') && (
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
            );
          })}

          <AutoFixHistory siteId={site.id} refreshKey={historyKey} />
        </>
      )}

      <AutoFixPreviewDialog
        siteId={site.id}
        fixKey={previewFix?.key ?? null}
        checkName={previewFix?.name ?? ''}
        open={previewFix !== null}
        onOpenChange={(o) => { if (!o) setPreviewFix(null); }}
        onApplied={() => { setHistoryKey((k) => k + 1); runScan(); }}
      />
    </div>
  );
}
