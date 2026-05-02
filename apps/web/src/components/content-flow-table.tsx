'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Lightbulb, Loader2, Calendar, FileCheck2, Send, Sparkles, RefreshCw, Eye } from 'lucide-react';
import { PipelineProgress, PIPELINE_STEPS } from '@/components/pipeline-progress';

/*
 * ContentFlowTable — TopicsStepBody + ArticlesStepBody'nin birleşik tablo karşılığı.
 *
 * Tek tabloda 5 farklı içerik durumu:
 *   - Önerilen (queue.tier1Topics — henüz makaleye dönüşmemiş)
 *   - Üretiliyor / Editör (article.status: GENERATING, EDITING)
 *   - Takvimde (article.status: SCHEDULED)
 *   - Hazır (article.status: READY_TO_PUBLISH)
 *   - Yayınlandı (article.status: PUBLISHED)
 *
 * "Hemen üret" → konu satırı "Üretiliyor" durumuna geçer (aynı satır kalır, persistant)
 * Bitince → "Hazır" / "Yayınlandı" durumuna düşer
 * Topic engine yenilenir → boş slot'lara yeni öneriler gelir
 */

type Row = {
  key: string;
  topic: string;
  slug?: string | null;
  pillar?: string | null;
  score?: number | null;
  persona?: string | null;
  state: 'suggested' | 'generating' | 'editing' | 'scheduled' | 'queued' | 'ready' | 'published' | 'failed';
  articleId?: string | null;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  publicUrl?: string | null;
  hasBody?: boolean; // gerçek içerik üretildi mi (Detay butonu için)
};

const STATE_CONFIG: Record<Row['state'], { label: string; color: string; bg: string; border: string; Icon: any }> = {
  suggested: { label: 'Önerilen', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', Icon: Lightbulb },
  generating: { label: 'Üretiliyor', color: 'text-brand', bg: 'bg-brand/10', border: 'border-brand/30', Icon: Loader2 },
  editing: { label: 'Editörde', color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/30', Icon: Loader2 },
  scheduled: { label: 'Takvimde', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', Icon: Calendar },
  queued: { label: 'Sırada (tarihsiz)', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', Icon: Calendar },
  ready: { label: 'Hazır (onay)', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', Icon: FileCheck2 },
  published: { label: 'Yayında', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', Icon: Send },
  failed: { label: 'Başarısız', color: 'text-red-600', bg: 'bg-red-500/10', border: 'border-red-500/30', Icon: Lightbulb },
};

export function ContentFlowTable({
  queue,
  articles = [],
  siteId,
  onRefresh,
  onboardingMode,
}: {
  queue: any;
  articles?: any[];
  siteId: string;
  onRefresh: () => void;
  onboardingMode?: boolean;
}) {
  const [running, setRunning] = useState(false);
  // Birden fazla bağımsız üretim için Set
  const [generatingTopics, setGeneratingTopics] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState<string | null>(null);
  const [triggeringSet, setTriggeringSet] = useState<Set<string>>(new Set());
  // Tarih atama modali (Sırada-tarihsiz article'ları takvime al)
  const [scheduleTarget, setScheduleTarget] = useState<{ articleId: string; title: string } | null>(null);
  const [scheduleTopicTarget, setScheduleTopicTarget] = useState<{ topic: string; slug?: string; pillar?: string; title: string } | null>(null);
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);

  const inflightArticle = (articles ?? []).find((a) => a?.status === 'GENERATING' || a?.status === 'EDITING');

  // triggeringSet temizliği — backend status GENERATING olduğunda kendi state'inden çıkar
  useEffect(() => {
    if (triggeringSet.size === 0) return;
    const toRemove: string[] = [];
    for (const id of triggeringSet) {
      const a = (articles ?? []).find((x) => x?.id === id);
      if (a && (a.status === 'GENERATING' || a.status === 'EDITING')) {
        toRemove.push(id);
      }
    }
    if (toRemove.length > 0) {
      setTriggeringSet((prev) => {
        const n = new Set(prev);
        toRemove.forEach((id) => n.delete(id));
        return n;
      });
    }
  }, [articles, triggeringSet]);
  const inflightTopic: string | null = inflightArticle
    ? String(inflightArticle.topic ?? inflightArticle.title ?? '')
    : null;
  // Aktif olarak çalışan herhangi bir üretim var mı (sadece info amaçlı, butonları kilitlemiyor)
  const anyInflight = !!inflightTopic || generatingTopics.size > 0;

  // Konu engine'i yeniden çalıştır
  const runTopicEngine = async () => {
    setRunning(true);
    try {
      await api.runTopicEngineNow(siteId);
      toast.success('Yeni konular hazırlandı');
      onRefresh();
    } catch (err: any) { toast.error(err.message); }
    finally { setRunning(false); }
  };

  const generate = async (topic: string) => {
    setGeneratingTopics((prev) => new Set(prev).add(topic));
    try {
      await api.generateArticle(siteId, topic);
      toast.success(`Üretim kuyruğa eklendi: "${topic.slice(0, 50)}…"`);
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      // Backend placeholder Article oluşturuyor — inflight liste güncellenince satır
      // 'generating' state'ine geçer, butı buradan da temizleyelim.
      setGeneratingTopics((prev) => {
        const n = new Set(prev);
        n.delete(topic);
        return n;
      });
    }
  };

  const publish = async (articleId: string) => {
    setPublishing(articleId);
    try {
      // Default publish target ile yayınla — frontend target seçimi yok burada
      const targets = await api.listPublishTargets(siteId);
      const def = targets.find((t: any) => t?.isDefault && t?.isActive);
      if (!def) {
        toast.error('Yayın hedefi yok — Yayın Hedefleri kartından ekle');
        return;
      }
      await api.publishArticle(siteId, articleId, [def.id]);
      toast.success('Yayın başlatıldı');
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPublishing(null);
    }
  };

  // Articles[]'tan halihazırda makaleye dönüşmüş topic'leri çıkart
  const usedTopicKeys = useMemo(() => {
    const s = new Set<string>();
    (articles ?? []).forEach((a) => {
      const k = String(a?.topic ?? a?.title ?? '').trim().toLowerCase();
      if (k) s.add(k);
    });
    return s;
  }, [articles]);

  // Tier 1 topic'leri (henüz makaleye dönüşmemiş)
  const tier1: any[] = (queue?.tier1Topics ?? []).filter((t: any) => {
    const k = String(t?.topic ?? '').trim().toLowerCase();
    return k && !usedTopicKeys.has(k);
  });

  // Birleşik satırlar (article state'ine göre sıralama)
  const rows: Row[] = useMemo(() => {
    // ÖNCE: aynı title'a sahip dublike article'ları temizle.
    // Aynı title için tarihi set olan + en güncel kaydı tut, diğerlerini gizle.
    const dedupedArticles: any[] = (() => {
      const byTitle = new Map<string, any>();
      const sorted = [...(articles ?? [])].sort((a, b) => {
        // 1) scheduledAt set olan üstte, null altta
        const aHas = !!a?.scheduledAt;
        const bHas = !!b?.scheduledAt;
        if (aHas !== bHas) return aHas ? -1 : 1;
        // 2) createdAt güncel üstte
        return new Date(b?.createdAt ?? 0).getTime() - new Date(a?.createdAt ?? 0).getTime();
      });
      sorted.forEach((a) => {
        const k = String(a?.title ?? a?.topic ?? '').trim().toLowerCase();
        if (!k) return;
        if (!byTitle.has(k)) byTitle.set(k, a);
      });
      return Array.from(byTitle.values());
    })();

    const all: Row[] = [];

    // Inflight + ready + scheduled + published
    dedupedArticles.forEach((a) => {
      let state: Row['state'] = 'failed';
      if (a.status === 'GENERATING') state = 'generating';
      else if (a.status === 'EDITING') state = 'editing';
      else if (a.status === 'SCHEDULED') {
        // scheduledAt yoksa veya geçersizse 'queued' (sırada-tarihsiz) olarak göster
        const sa = a.scheduledAt ? new Date(a.scheduledAt) : null;
        state = sa && !isNaN(sa.getTime()) ? 'scheduled' : 'queued';
      }
      else if (a.status === 'READY_TO_PUBLISH') state = 'ready';
      else if (a.status === 'PUBLISHED') state = 'published';
      else if (a.status === 'FAILED') state = 'failed';

      // İçerik gerçekten üretilmiş mi? bodyMd veya wordCount kontrolü
      const wc = typeof a.wordCount === 'number' ? a.wordCount : 0;
      const hasBody = wc >= 100 || (typeof a.bodyMd === 'string' && a.bodyMd.length > 200);

      all.push({
        key: `art-${a.id}`,
        topic: a.title || a.topic || '(başlıksız)',
        score: a.score ?? null,
        persona: a.persona ?? null,
        state,
        articleId: a.id,
        scheduledAt: a.scheduledAt,
        publishedAt: a.publishedAt,
        publicUrl: a.publicUrl ?? a.url ?? null,
        hasBody,
      });
    });

    // Önerilen topic'ler
    tier1.forEach((t) => {
      all.push({
        key: `topic-${t.topic}`,
        topic: t.topic,
        slug: t.slug ?? null,
        pillar: t.pillar ?? null,
        score: t.score ?? null,
        persona: t.persona ?? null,
        state: 'suggested',
      });
    });

    // Sıralama (yukarıdan aşağı):
    //   1) Önerilen (yeni öneriler en üstte)
    //   2) Üretiliyor / Editörde (canlı iş)
    //   3) Hazır (onay bekliyor)
    //   4) Sırada (tarihsiz)
    //   5) Yayında (geçmiş)
    //   6) Takvimde (gelecek - en altta)
    //   7) Başarısız
    const order: Record<Row['state'], number> = {
      suggested: 0,
      generating: 1,
      editing: 2,
      ready: 3,
      queued: 4,
      published: 5,
      scheduled: 6,
      failed: 7,
    };
    return all.sort((a, b) => order[a.state] - order[b.state]);
  }, [articles, tier1]);

  if (!queue && articles.length === 0) {
    if (onboardingMode || running) {
      return (
        <PipelineProgress
          title="İçerik konuları hazırlanıyor"
          steps={PIPELINE_STEPS.topicEngine}
          running
        />
      );
    }
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <p className="text-sm text-muted-foreground mb-4">Henüz konu yok.</p>
          <Button onClick={runTopicEngine}>
            <Sparkles className="h-4 w-4 mr-1.5" /> Topic Engine Çalıştır
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Inflight pipeline gauge — F5 sonrası persistent */}
      {(running || anyInflight) && (() => {
        const firstGen = Array.from(generatingTopics)[0];
        const showTopic = firstGen ?? inflightTopic;
        return (
          <PipelineProgress
            title={
              showTopic
                ? `Makale üretiliyor: "${showTopic.slice(0, 60)}…"`
                : 'Topic Engine yenileniyor'
            }
            steps={showTopic ? PIPELINE_STEPS.article : PIPELINE_STEPS.topicEngine}
            running
          />
        );
      })()}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                İçerik Akışı
                <span className="inline-flex items-center gap-1 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                  <span className="h-2 w-0.5 bg-amber-400/70 rounded" /> AI önerisi
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-normal text-brand">
                  <span className="h-2 w-0.5 bg-brand rounded" /> üretilen
                </span>
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Önerilen konular, üretilenler ve yayında olanlar tek tabloda. Önerilenleri sürükleyip takvime alabilir veya direkt üretime gönderebilirsin.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={runTopicEngine}
              disabled={running}
            >
              <RefreshCw className={cn('h-4 w-4 mr-1', running && 'animate-spin')} />
              {running ? 'Yenileniyor…' : 'Yeni öneriler'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-12 text-center border-t">
              <p className="text-sm text-muted-foreground">Henüz içerik yok.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border-t">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 text-muted-foreground border-b">
                    <th className="text-left font-medium px-4 py-2.5 w-[40%]">Başlık</th>
                    <th className="text-left font-medium px-4 py-2.5 hidden md:table-cell">Skor</th>
                    <th className="text-left font-medium px-4 py-2.5 hidden lg:table-cell">Persona</th>
                    <th className="text-left font-medium px-4 py-2.5">Durum</th>
                    <th className="text-right font-medium px-4 py-2.5">Aksiyon</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => {
                    const cfg = STATE_CONFIG[row.state];
                    const Icon = cfg.Icon;
                    const isInflight = row.state === 'generating' || row.state === 'editing';
                    const isThisGenerating = generatingTopics.has(row.topic);
                    // Görsel ayrım: AI önerisi mi yoksa üretilmiş/üretiliyor article mı?
                    // Sol border accent kullanılır — kullanıcı tek bakışta anlasın.
                    const isAISuggestion = row.state === 'suggested';
                    const leftAccent = isAISuggestion
                      ? 'border-l-4 border-l-amber-400/70'
                      : isInflight
                        ? 'border-l-4 border-l-brand'
                        : row.state === 'published'
                          ? 'border-l-4 border-l-emerald-500/70'
                          : row.state === 'scheduled'
                            ? 'border-l-4 border-l-blue-500/50'
                            : row.state === 'ready'
                              ? 'border-l-4 border-l-emerald-400/70'
                              : 'border-l-4 border-l-transparent';

                    return (
                      <tr
                        key={row.key}
                        className={cn(
                          'transition-colors',
                          leftAccent,
                          isInflight && 'bg-brand/5',
                          isAISuggestion && 'bg-amber-500/[0.025] hover:bg-amber-500/5',
                          !isAISuggestion && !isInflight && 'hover:bg-muted/30',
                        )}
                      >
                        <td className="px-4 py-3 align-top">
                          {row.state === 'suggested' ? (
                            <div
                              draggable
                              onDragStart={(e: React.DragEvent) => {
                                e.dataTransfer.setData(
                                  'application/x-luviai-topic',
                                  JSON.stringify({
                                    topic: row.topic,
                                    slug: row.slug ?? undefined,
                                    pillar: row.pillar ?? undefined,
                                    score: row.score,
                                  }),
                                );
                                e.dataTransfer.effectAllowed = 'copyMove';
                              }}
                              className="cursor-grab active:cursor-grabbing inline-flex items-start gap-2 -mx-1 -my-0.5 px-2 py-1 rounded hover:bg-amber-500/5 hover:ring-1 hover:ring-amber-500/30 transition-all"
                              title="Sürükleyip takvime bırak"
                            >
                              <span className="text-amber-500 mt-0.5 select-none" aria-hidden>⠿</span>
                              <span className="font-medium leading-snug">{row.topic}</span>
                            </div>
                          ) : (row.state === 'queued' || row.state === 'scheduled') && row.articleId ? (
                            <div
                              draggable
                              onDragStart={(e: React.DragEvent) => {
                                e.dataTransfer.setData(
                                  'application/x-luviai-article',
                                  JSON.stringify({ id: row.articleId, title: row.topic }),
                                );
                                e.dataTransfer.effectAllowed = 'copyMove';
                              }}
                              className={cn(
                                'cursor-grab active:cursor-grabbing inline-flex items-start gap-2 -mx-1 -my-0.5 px-2 py-1 rounded transition-all',
                                row.state === 'queued'
                                  ? 'hover:bg-amber-500/5 hover:ring-1 hover:ring-amber-500/30'
                                  : 'hover:bg-blue-500/5 hover:ring-1 hover:ring-blue-500/30',
                              )}
                              title={row.state === 'queued' ? 'Sürükleyip takvime bırak (tarih ata)' : 'Sürükleyip takvimde başka güne taşı'}
                            >
                              <span
                                className={cn('mt-0.5 select-none', row.state === 'queued' ? 'text-amber-500' : 'text-blue-500')}
                                aria-hidden
                              >⠿</span>
                              <span className="font-medium leading-snug">{row.topic}</span>
                            </div>
                          ) : (
                            <div className="font-medium leading-snug">{row.topic}</div>
                          )}
                          {row.scheduledAt && row.state === 'scheduled' && (() => {
                            const d = new Date(row.scheduledAt);
                            const now = new Date();
                            const sameMonth = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
                            return (
                              <div className={cn(
                                'text-[11px] mt-0.5 font-mono',
                                sameMonth ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400 font-semibold',
                              )}>
                                {d.toLocaleString('tr-TR', {
                                  weekday: 'short',
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                                {!sameMonth && ' · ⚠ takvimde başka ay'}
                              </div>
                            );
                          })()}
                          {row.publishedAt && row.state === 'published' && (
                            <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                              Yayın: {new Date(row.publishedAt).toLocaleDateString('tr-TR')}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top hidden md:table-cell">
                          {row.score != null ? <Badge variant="outline">{row.score}</Badge> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 align-top hidden lg:table-cell text-xs text-muted-foreground">
                          {row.persona ?? '—'}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold border',
                              cfg.color,
                              cfg.bg,
                              cfg.border,
                            )}
                          >
                            <Icon className={cn('h-3 w-3', isInflight && 'animate-spin')} />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          {row.state === 'suggested' && (
                            <div className="flex items-center justify-end gap-1.5">
                              {isThisGenerating ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand px-3 py-1.5">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Üretiliyor…
                                </span>
                              ) : (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setScheduleTopicTarget({
                                        topic: row.topic,
                                        slug: row.slug ?? undefined,
                                        pillar: row.pillar ?? undefined,
                                        title: row.topic,
                                      })
                                    }
                                    title="Takvime ekle (yayın saati gelince üret + yayınla)"
                                  >
                                    <Calendar className="h-3.5 w-3.5 mr-1" /> Takvime
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => generate(row.topic)}
                                    disabled={isThisGenerating}
                                    title="Şimdi üret (anında pipeline)"
                                  >
                                    Üret →
                                  </Button>
                                </>
                              )}
                            </div>
                          )}
                          {(row.state === 'generating' || row.state === 'editing') && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Üretiliyor…
                            </span>
                          )}
                          {row.state === 'scheduled' && (() => {
                            const isTriggering = !!row.articleId && triggeringSet.has(row.articleId);
                            return (
                              <div className="flex items-center justify-end gap-1.5">
                                {isTriggering ? (
                                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand px-3 py-1.5">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Üretiliyor…
                                  </span>
                                ) : (
                                  <Button
                                    size="sm"
                                    onClick={async () => {
                                      if (!row.articleId) return;
                                      const aid = row.articleId;
                                      setTriggeringSet((prev) => new Set(prev).add(aid));
                                      try {
                                        await api.triggerArticleNow(siteId, aid);
                                        toast.success(`Üretim kuyruğa eklendi: "${row.topic.slice(0, 50)}…"`);
                                        onRefresh();
                                      } catch (err: any) {
                                        toast.error(err.message || 'Üretim tetiklenemedi');
                                        setTriggeringSet((prev) => {
                                          const n = new Set(prev);
                                          n.delete(aid);
                                          return n;
                                        });
                                      }
                                    }}
                                  >
                                    Şimdi üret
                                  </Button>
                                )}
                                {row.hasBody && (
                                  <Link href={`/sites/${siteId}/articles/${row.articleId}`}>
                                    <Button size="sm" variant="outline" title="Detay">
                                      <Eye className="h-3.5 w-3.5" />
                                    </Button>
                                  </Link>
                                )}
                              </div>
                            );
                          })()}
                          {row.state === 'queued' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                row.articleId &&
                                setScheduleTarget({ articleId: row.articleId, title: row.topic })
                              }
                            >
                              <Calendar className="h-3.5 w-3.5 mr-1" /> Tarih ata
                            </Button>
                          )}
                          {row.state === 'ready' && (
                            <div className="flex items-center justify-end gap-1.5">
                              <Link href={`/sites/${siteId}/articles/${row.articleId}`}>
                                <Button size="sm" variant="outline">
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </Link>
                              <Button
                                size="sm"
                                onClick={() => row.articleId && publish(row.articleId)}
                                disabled={publishing === row.articleId}
                              >
                                {publishing === row.articleId ? '…' : 'Yayınla →'}
                              </Button>
                            </div>
                          )}
                          {row.state === 'published' && (
                            <div className="flex items-center justify-end gap-1.5">
                              {row.publicUrl && (
                                <a
                                  href={row.publicUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border hover:border-brand hover:text-brand transition-colors"
                                >
                                  🔗 Aç
                                </a>
                              )}
                              <Link href={`/sites/${siteId}/articles/${row.articleId}`}>
                                <Button size="sm" variant="outline">
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </Link>
                            </div>
                          )}
                          {row.state === 'failed' && (
                            <span className="text-xs text-red-500 italic">başarısız</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tarih atama modali — Sırada (tarihsiz) article'ları takvime al */}
      {scheduleTarget && (
        <ScheduleModal
          title={scheduleTarget.title}
          submitting={scheduleSubmitting}
          onClose={() => setScheduleTarget(null)}
          onConfirm={async (iso) => {
            if (!scheduleTarget) return;
            setScheduleSubmitting(true);
            try {
              await api.rescheduleArticle(siteId, scheduleTarget.articleId, iso);
              toast.success('Tarih atandı');
              setScheduleTarget(null);
              onRefresh();
            } catch (err: any) {
              toast.error(err.message || 'Tarih atanamadı');
            } finally {
              setScheduleSubmitting(false);
            }
          }}
        />
      )}

      {/* Tarih atama modali — Önerilen Konu'yu doğrudan takvime al (yeni article schedule) */}
      {scheduleTopicTarget && (
        <ScheduleModal
          title={scheduleTopicTarget.title}
          submitting={scheduleSubmitting}
          onClose={() => setScheduleTopicTarget(null)}
          onConfirm={async (iso) => {
            if (!scheduleTopicTarget) return;
            setScheduleSubmitting(true);
            try {
              await api.scheduleTopicToCalendar(siteId, {
                topic: scheduleTopicTarget.topic,
                slug: scheduleTopicTarget.slug,
                pillar: scheduleTopicTarget.pillar,
                scheduledAt: iso,
              });
              toast.success('Konu takvime eklendi — saatinde otomatik üretilecek');
              setScheduleTopicTarget(null);
              onRefresh();
            } catch (err: any) {
              toast.error(err.message || 'Takvime eklenemedi');
            } finally {
              setScheduleSubmitting(false);
            }
          }}
        />
      )}
    </div>
  );
}

function ScheduleModal({
  title, submitting, onClose, onConfirm,
}: {
  title: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (iso: string) => void;
}) {
  // Default: yarın 10:00 (yerel TZ)
  const defaultDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('10:00');

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader>
          <h3 className="font-semibold">Tarih ve saat seç</h3>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{title}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-foreground/70 mb-1 block">Tarih</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-foreground/70 mb-1 block">Saat</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm"
                step="900"
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>İptal</Button>
            <Button
              onClick={() => {
                const iso = new Date(`${date}T${time}:00`).toISOString();
                onConfirm(iso);
              }}
              disabled={submitting || !date || !time}
            >
              {submitting ? 'Atanıyor…' : 'Takvime ekle'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
