'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Beaker, Plus, Play, Trash2, GitBranch, Sparkles, Download,
  ChevronDown, ChevronRight, AlertTriangle, Check, Loader2, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterChip } from '@/components/ui/filter-chip';
import { SectionHeader } from '@/components/ui/section-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Prompt Lab — kullanicinin takip ettigi sorular + fan-out dallari.
 *
 * Iki sekme:
 *  1. Sorular: takip listesi, tek tek veya toplu calistirma
 *  2. Kapsama: ana soru vs fan-out dallari farki (asil urun degeri)
 */

type Prompt = {
  id: string; text: string; intent: string; locale: string; source: string;
  isActive: boolean; fanoutCount: number;
  lastRunAt: string | null; lastCitedCount: number; lastTotalCount: number;
  lastScore: number | null; createdAt: string;
};

type Branch = {
  id: string; text: string; kind: string; likelihood: number;
  rank: number; isActive: boolean; generatedBy: string;
};

const KIND_LABEL: Record<string, string> = {
  reviews: 'Yorumlar',
  trust: 'Güven',
  comparison: 'Karşılaştırma',
  pricing: 'Fiyat',
  alternatives: 'Alternatifler',
  howto: 'Nasıl yapılır',
  local: 'Yerel',
  spec: 'Özellikler',
  category: 'Kategori',
  unknown: 'Diğer',
};

const INTENT_LABEL: Record<string, string> = {
  informational: 'Bilgi',
  commercial: 'Ticari',
  comparison: 'Karşılaştırma',
  transactional: 'Satın alma',
  brand: 'Marka',
};

function scoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 60) return 'text-success';
  if (score >= 25) return 'text-warning';
  return 'text-danger';
}

export function PromptLabPanel({ siteId }: { siteId: string }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <SectionHeader
          as="h3"
          icon={Beaker}
          title="Prompt Lab — takip ettiğin sorular"
          description="Kendi sorularını takibe al, modelin arka planda açtığı alt sorgu dallarını (fan-out) ölç."
        />

        {/* Elle cizilmis sekme cubugu yerine ui/tabs (Radix: rol, klavye, aria-selected) */}
        <Tabs defaultValue="prompts">
          <TabsList>
            <TabsTrigger value="prompts">
              <Beaker className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Sorular
            </TabsTrigger>
            <TabsTrigger value="coverage">
              <GitBranch className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Kapsama
            </TabsTrigger>
          </TabsList>
          <TabsContent value="prompts" className="mt-3">
            <PromptsTab siteId={siteId} />
          </TabsContent>
          <TabsContent value="coverage" className="mt-3">
            <CoverageTab siteId={siteId} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════
//  SEKME 1 — Takip listesi
// ══════════════════════════════════════════════════════════════
function PromptsTab({ siteId }: { siteId: string }) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState('');
  const [newIntent, setNewIntent] = useState('informational');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPrompts(await api.listPrompts(siteId));
    } catch (err: any) {
      toast.error(err?.message ?? 'Sorular yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (newText.trim().length < 5) {
      toast.error('Soru en az 5 karakter olmalı');
      return;
    }
    setAdding(true);
    try {
      await api.createPrompt(siteId, { text: newText.trim(), intent: newIntent });
      setNewText('');
      toast.success('Soru takibe alındı');
      await load();
    } catch (err: any) {
      toast.error(err?.message ?? 'Eklenemedi');
    } finally {
      setAdding(false);
    }
  }

  async function importBrain() {
    setImporting(true);
    try {
      const res = await api.importPromptsFromBrain(siteId);
      toast.success(`${res.imported} soru aktarıldı${res.skipped ? `, ${res.skipped} atlandı` : ''}`);
      await load();
    } catch (err: any) {
      toast.error(err?.message ?? 'Aktarılamadı');
    } finally {
      setImporting(false);
    }
  }

  async function runAll() {
    setRunningAll(true);
    try {
      const res = await api.runAllPrompts(siteId, { withFanout: false, limit: 25 });
      toast.success(`${res.ran} soru çalıştırıldı`);
      await load();
    } catch (err: any) {
      toast.error(err?.message ?? 'Çalıştırılamadı');
    } finally {
      setRunningAll(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.deletePrompt(siteId, id);
      setPrompts((prev) => prev.filter((p) => p.id !== id));
      toast.success('Silindi');
    } catch (err: any) {
      toast.error(err?.message ?? 'Silinemedi');
    }
  }

  return (
    <div className="space-y-3">
      {/* Ekleme satırı */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !adding) void add(); }}
          placeholder="Örn: KOBİ'ler için en uygun ticari kredi hangisi?"
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-xs"
        />
        <select
          value={newIntent}
          onChange={(e) => setNewIntent(e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-xs"
        >
          {Object.entries(INTENT_LABEL).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <Button size="sm" onClick={add} disabled={adding}>
          {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Ekle
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={importBrain} disabled={importing}>
          {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Brain'den aktar
        </Button>
        <Button size="sm" variant="outline" onClick={runAll} disabled={runningAll || prompts.length === 0}>
          {runningAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Tümünü çalıştır
        </Button>
      </div>

      {loading ? (
        <div className="space-y-1.5" aria-busy="true" aria-label="Sorular yükleniyor">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-11 w-full" />)}
        </div>
      ) : prompts.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center">
          <p className="text-xs text-muted-foreground">
            Henüz takip edilen soru yok. Yukarıdan ekleyin veya Brain'deki mevcut GEO sorgularını aktarın.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {prompts.map((p) => (
            <PromptRow
              key={p.id}
              siteId={siteId}
              prompt={p}
              isOpen={expanded === p.id}
              onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
              onDelete={() => remove(p.id)}
              onRan={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Tek soru satırı + fan-out dalları
// ══════════════════════════════════════════════════════════════
function PromptRow({
  siteId, prompt, isOpen, onToggle, onDelete, onRan,
}: {
  siteId: string;
  prompt: Prompt;
  isOpen: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRan: () => void;
}) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<Awaited<ReturnType<typeof api.runPrompt>> | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoadingBranches(true);
    api.listFanout(siteId, prompt.id)
      .then((b) => { if (!cancelled) setBranches(b); })
      .catch(() => { /* panel boş kalır, hata toast'ı gürültü yapmasın */ })
      .finally(() => { if (!cancelled) setLoadingBranches(false); });
    return () => { cancelled = true; };
  }, [isOpen, siteId, prompt.id]);

  async function generate() {
    setGenerating(true);
    try {
      const res = await api.generateFanout(siteId, prompt.id, 8);
      toast.success(
        res.reactivated
          ? `${res.generated} yeni dal, ${res.reactivated} dal geçmişiyle korundu`
          : `${res.generated} dal üretildi`,
      );
      setBranches(await api.listFanout(siteId, prompt.id));
    } catch (err: any) {
      toast.error(err?.message ?? 'Dallar üretilemedi');
    } finally {
      setGenerating(false);
    }
  }

  async function run(withFanout: boolean) {
    setRunning(true);
    try {
      const res = await api.runPrompt(siteId, prompt.id, { withFanout });
      setLastRun(res);
      toast.success(`Ana soru: %${res.main.score}${res.fanout ? ` · Dallar: %${res.fanout.score}` : ''}`);
      onRan();
    } catch (err: any) {
      toast.error(err?.message ?? 'Çalıştırılamadı');
    } finally {
      setRunning(false);
    }
  }

  async function removeBranch(id: string) {
    try {
      await api.deleteFanout(siteId, id);
      setBranches((prev) => prev.filter((b) => b.id !== id));
    } catch (err: any) {
      toast.error(err?.message ?? 'Silinemedi');
    }
  }

  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-2 p-2">
        <button onClick={onToggle} className="text-muted-foreground hover:text-foreground shrink-0">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{prompt.text}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <Badge variant="outline" className="text-label px-1 py-0">
              {INTENT_LABEL[prompt.intent] ?? prompt.intent}
            </Badge>
            {prompt.source === 'brain' && (
              <Badge variant="outline" className="text-label px-1 py-0">Brain</Badge>
            )}
            {prompt.fanoutCount > 0 && (
              <span className="text-label text-muted-foreground inline-flex items-center gap-0.5">
                <GitBranch className="h-2.5 w-2.5" /> {prompt.fanoutCount} dal
              </span>
            )}
            {prompt.lastRunAt && (
              <span className="text-label text-muted-foreground">
                {new Date(prompt.lastRunAt).toLocaleDateString('tr-TR')}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className={`text-sm font-semibold tabular-nums ${scoreColor(prompt.lastScore)}`}>
            {prompt.lastScore === null ? '—' : `%${prompt.lastScore}`}
          </p>
          <p className="text-label text-muted-foreground">
            {prompt.lastTotalCount > 0 ? `${prompt.lastCitedCount}/${prompt.lastTotalCount}` : 'test edilmedi'}
          </p>
        </div>

        <Button size="sm" variant="ghost" onClick={() => run(false)} disabled={running} title="Ana soruyu çalıştır">
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} title="Sil">
          <Trash2 className="h-3 w-3 text-danger" />
        </Button>
      </div>

      {isOpen && (
        <div className="border-t px-3 py-2.5 space-y-2.5 bg-muted/30">
          {/* Fan-out açıklaması — kullanıcı bunun tahmin olduğunu bilmeli */}
          <div className="flex items-start gap-1.5 text-label text-muted-foreground">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              Fan-out dalları, modellerin bu soruyu cevaplarken arka planda açması <em>muhtemel</em> alt
              sorgulardır. Sağlayıcılar gerçek iç sorgularını paylaşmadığı için bunlar tahmindir.
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={generate} disabled={generating}>
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {branches.length ? 'Dalları yenile' : 'Dalları üret'}
            </Button>
            {branches.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => run(true)} disabled={running}>
                {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Dallarla çalıştır
              </Button>
            )}
          </div>

          {loadingBranches ? (
            <p className="text-label text-muted-foreground">Dallar yükleniyor…</p>
          ) : branches.length === 0 ? (
            <p className="text-label text-muted-foreground">
              Henüz dal yok. "Dalları üret" ile modelin bu soruyu nasıl açacağını tahmin edin.
            </p>
          ) : (
            <div className="space-y-1">
              {branches.map((b) => (
                <div key={b.id} className="flex items-center gap-2 text-label py-0.5">
                  <Badge variant="outline" className="text-label px-1 py-0 shrink-0">
                    {KIND_LABEL[b.kind] ?? b.kind}
                  </Badge>
                  <span className="flex-1 min-w-0 truncate">{b.text}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0" title="Modelin bu dalı açma olasılığı tahmini">
                    %{b.likelihood}
                  </span>
                  {b.generatedBy === 'manual' && (
                    <Badge variant="outline" className="text-label px-1 py-0 shrink-0">elle</Badge>
                  )}
                  <button onClick={() => removeBranch(b.id)} className="shrink-0 text-muted-foreground hover:text-danger">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Son çalıştırma sonucu */}
          {lastRun && (
            <div className="rounded-md border bg-background p-2 space-y-1.5">
              <div className="flex gap-4 text-label">
                <span>
                  Ana soru: <strong className={scoreColor(lastRun.main.score)}>%{lastRun.main.score}</strong>
                  <span className="text-muted-foreground"> ({lastRun.main.cited}/{lastRun.main.total})</span>
                </span>
                {lastRun.fanout && (
                  <span>
                    Dallar: <strong className={scoreColor(lastRun.fanout.score)}>%{lastRun.fanout.score}</strong>
                    <span className="text-muted-foreground"> ({lastRun.fanout.cited}/{lastRun.fanout.total})</span>
                  </span>
                )}
              </div>

              {lastRun.weakestBranches.length > 0 && (
                <div>
                  <p className="text-label text-muted-foreground mb-0.5">En zayıf dallar:</p>
                  {lastRun.weakestBranches.map((w) => (
                    <div key={w.id} className="text-label flex items-center gap-1.5">
                      <span className="text-danger">●</span>
                      <span className="flex-1 truncate">{w.text}</span>
                      <span className="text-muted-foreground tabular-nums">{w.citedCount}/{w.total}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1">
                {lastRun.providers.map((pr) => (
                  <Badge
                    key={pr.provider}
                    variant="outline"
                    className="text-label px-1 py-0"
                    title={pr.reason ?? pr.label}
                  >
                    {pr.available
                      ? (pr.probes.some((x: any) => x.cited)
                          ? <Check className="h-2.5 w-2.5 text-success inline" />
                          : <span className="text-muted-foreground">·</span>)
                      : <X className="h-2.5 w-2.5 text-muted-foreground inline" aria-label="kullanılamıyor" />}
                    {' '}{pr.label}
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

// ══════════════════════════════════════════════════════════════
//  SEKME 2 — Kapsama: ana soru vs dallar
// ══════════════════════════════════════════════════════════════
function CoverageTab({ siteId }: { siteId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.promptCoverage>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.promptCoverage(siteId, days)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err: any) => { if (!cancelled) toast.error(err?.message ?? 'Kapsama yüklenemedi'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [siteId, days]);

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Kapsama yükleniyor">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!data) return null;

  const hasData = data.main.total > 0 || data.fanout.total > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Dönem:</span>
        {[7, 30, 90].map((d) => (
          <FilterChip key={d} selected={days === d} onClick={() => setDays(d)}>
            {d} gün
          </FilterChip>
        ))}
      </div>

      {!hasData ? (
        <div className="rounded-md border border-dashed p-6 text-center">
          <p className="text-xs text-muted-foreground">
            Bu dönemde ölçüm yok. Sorular sekmesinden bir soruyu dallarıyla birlikte çalıştırın.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border p-3">
              <p className="text-label text-muted-foreground">Ana sorular</p>
              {data.main.score === null ? (
                <p className="text-xl font-semibold text-muted-foreground">—</p>
              ) : (
                <p className={`text-xl font-semibold tabular-nums ${scoreColor(data.main.score)}`}>
                  %{data.main.score}
                </p>
              )}
              <p className="text-label text-muted-foreground">
                {data.main.score === null
                  ? 'Ölçülecek markasız soru yok'
                  : `${data.main.cited}/${data.main.total} ölçümde alıntılandı`}
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-label text-muted-foreground">Fan-out dalları</p>
              {data.fanout.score === null ? (
                <p className="text-xl font-semibold text-muted-foreground">—</p>
              ) : (
                <p className={`text-xl font-semibold tabular-nums ${scoreColor(data.fanout.score)}`}>
                  %{data.fanout.score}
                </p>
              )}
              <p className="text-label text-muted-foreground">
                {data.fanout.score === null
                  ? 'Ölçülecek markasız dal yok'
                  : `${data.fanout.cited}/${data.fanout.total} ölçümde alıntılandı`}
              </p>
            </div>
          </div>

          {/* Asıl bulgu — fark */}
          {data.fanout.total > 0 && data.gap !== null && (
            <div className={`rounded-md border p-3 ${data.gap < -15 ? 'border-danger/40 bg-danger/50' : ''}`}>
              <p className="text-xs font-medium">
                {data.gap < -15
                  ? `Dallarda ${Math.abs(data.gap)} puan geridesin`
                  : data.gap > 15
                    ? `Dallarda ${data.gap} puan öndesin`
                    : 'Ana soru ve dallar dengeli'}
              </p>
              <p className="text-label text-muted-foreground mt-0.5">
                {data.gap < -15
                  ? 'Kullanıcının sorduğu soruda görünüyorsun ama modelin arka planda açtığı dallarda kayboluyorsun. Aşağıdaki en zayıf dal tiplerine içerik üretmek en hızlı kazanç.'
                  : 'Ana soru ile alt sorgu dalları arasında ciddi bir kopukluk yok.'}
              </p>
            </div>
          )}

          {data.byKind.length > 0 && (
            <div className="rounded-md border overflow-hidden">
              <div className="px-3 py-1.5 bg-muted/50 text-label font-medium">
                Dal tipine göre görünürlük (zayıftan güçlüye)
              </div>
              <div className="divide-y">
                {data.byKind.map((k) => (
                  <div key={k.kind} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="text-label w-28 shrink-0">{KIND_LABEL[k.kind] ?? k.kind}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${k.score >= 60 ? 'bg-success' : k.score >= 25 ? 'bg-warning' : 'bg-danger'}`}
                        style={{ width: `${k.score}%` }}
                      />
                    </div>
                    <span className={`text-label tabular-nums w-10 text-right ${scoreColor(k.score)}`}>
                      %{k.score}
                    </span>
                    <span className="text-label text-muted-foreground tabular-nums w-12 text-right">
                      {k.cited}/{k.total}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
