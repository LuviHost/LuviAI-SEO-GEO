'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { overwriteRemoteEditsConfirm, pollJob, publishJobOutcome, publishOutcomeView } from '@/lib/publish-result';
import { tablePublishDescription, tablePublishPlan, targetDisplayName } from '@/lib/publish-targets';
import { manualUpdateBadge } from '@/lib/manual-update';
import { showNotice } from '@/lib/notice';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Lightbulb, Loader2, Calendar, FileCheck2, Send, Sparkles, RefreshCw, Eye, Lock } from 'lucide-react';
import { isPlanLocked } from '@/lib/plan-lock';
import { LockedGenerateButton, LockedRowPreview, PlanUpgradeButton } from '@/components/locked-article';
import { refreshArticleAllowance, useArticleAllowance } from '@/lib/use-article-allowance';
import { PipelineProgress, PIPELINE_STEPS } from '@/components/pipeline-progress';
import { ArticleVideoButton } from '@/components/article-video';

/*
 * ContentFlowTable — TopicsStepBody + ArticlesStepBody'nin birleşik tablo karşılığı.
 *
 * Tek tabloda 5 farklı içerik durumu:
 *   - Önerilen (queue.tier1Topics — henüz makaleye dönüşmemiş)
 *   - Üretiliyor / Editör (article.status: GENERATING, EDITING)
 *   - Takvimde (article.status: SCHEDULED)
 *   - Kilitli (SCHEDULED + sunucunun lockedByPlan'i: deneme hakki doldu, plan
 *     yukseltilince yazilir; lib/plan-lock.ts) — uretim dugmesi yok, yukseltme var
 *   - Hazır (article.status: READY_TO_PUBLISH)
 *   - Yayınlandı (article.status: PUBLISHED)
 *
 * "Hemen üret" → konu satırı "Üretiliyor" durumuna geçer (aynı satır kalır, persistant)
 * Bitince → "Hazır" / "Yayınlandı" durumuna düşer
 * Topic engine yenilenir → boş slot'lara yeni öneriler gelir
 *
 * Makale hakki bitince (sitenin sahibinin hesabi; lib/article-allowance.ts) "Uret",
 * "Takvime" ve "Simdi uret" yerine kilitli "Planini yukselt" dugmesi durur: o istekler
 * sunucudan 403 donerdi. Kapi yine sunucuda; hak okunamazsa dugmeler acik kalir.
 */

type Row = {
  key: string;
  topic: string;
  slug?: string | null;
  pillar?: string | null;
  score?: number | null;
  persona?: string | null;
  state: 'suggested' | 'generating' | 'editing' | 'scheduled' | 'queued' | 'locked' | 'ready' | 'published' | 'failed';
  articleId?: string | null;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  publicUrl?: string | null;
  hasBody?: boolean; // gerçek içerik üretildi mi (Detay butonu için)
  /** Yazinin eski surumu yerinde guncellenemeyen bir hedefte yayinda (lib/manual-update.ts) */
  manualUpdate?: { label: string; title: string } | null;
};

export type ContentRowState = Row['state'];

// Durum tonlari token'dan (success/warning/danger/info) — yeni renk yok
const STATE_CONFIG: Record<Row['state'], { label: string; color: string; bg: string; border: string; Icon: any }> = {
  suggested: { label: 'Önerilen', color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30', Icon: Lightbulb },
  generating: { label: 'Üretiliyor', color: 'text-brand', bg: 'bg-brand/10', border: 'border-brand/30', Icon: Loader2 },
  editing: { label: 'Editörde', color: 'text-brand', bg: 'bg-brand/10', border: 'border-brand/30', Icon: Loader2 },
  scheduled: { label: 'Takvimde', color: 'text-info', bg: 'bg-info/10', border: 'border-info/30', Icon: Calendar },
  queued: { label: 'Sırada (tarihsiz)', color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30', Icon: Calendar },
  locked: { label: 'Kilitli', color: 'text-muted-foreground', bg: 'bg-muted', border: 'border-border', Icon: Lock },
  ready: { label: 'Hazır (onay)', color: 'text-success', bg: 'bg-success/10', border: 'border-success/30', Icon: FileCheck2 },
  published: { label: 'Yayında', color: 'text-success', bg: 'bg-success/10', border: 'border-success/30', Icon: Send },
  failed: { label: 'Başarısız', color: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/30', Icon: Lightbulb },
};

export function ContentFlowTable({
  queue,
  articles = [],
  siteId,
  onRefresh,
  onboardingMode,
  stateFilter,
  ownerId,
}: {
  queue: any;
  articles?: any[];
  siteId: string;
  /** Sitenin sahibi (site.userId): makale hakki onun hesabindan duser */
  ownerId?: string | null;
  onRefresh: () => void;
  onboardingMode?: boolean;
  /** Verilirse yalnizca bu durumlardaki satirlar gosterilir (sayfa ustundeki filtre cipleri) */
  stateFilter?: ReadonlyArray<Row['state']> | null;
}) {
  const [running, setRunning] = useState(false);
  // Birden fazla bağımsız üretim için Set
  const [generatingTopics, setGeneratingTopics] = useState<Set<string>>(new Set());
  // Yayin sonucu yoklanirken satir mesgul kalir; birden fazla satir ayni anda yayinlanabilir
  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const confirm = useConfirm();
  // siteId: denemede "Uret" sitede yayin hedefi bagliyken acilir (kilit "Önce yayın hedefini bağla")
  const allowance = useArticleAllowance(ownerId, siteId);
  // Kaynak eksikligi takvime eklemeyi engellemez (konu basligi denemede serbest); yalniz uretimi
  const generationOnlyLock = allowance.locked && allowance.reason === 'source_required';
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
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
  // Uretim bitince (yazi hazir ya da basarisiz → hak iadesi) hak yeniden okunur:
  // iade edilen hakla dugme kilitli kalmasin, son hakki kullanan uretim de kilitlesin
  const inflightCount = (articles ?? []).filter((a) => a?.status === 'GENERATING' || a?.status === 'EDITING').length;
  const prevInflight = useRef(inflightCount);
  useEffect(() => {
    if (inflightCount < prevInflight.current) refreshArticleAllowance(ownerId);
    prevInflight.current = inflightCount;
  }, [inflightCount, ownerId]);
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
      // Basarida da 403'te de hak tazelenir (son hak kullanildiysa dugmeler kilitlenir)
      refreshArticleAllowance(ownerId);
      // Backend placeholder Article oluşturuyor — inflight liste güncellenince satır
      // 'generating' state'ine geçer, butı buradan da temizleyelim.
      setGeneratingTopics((prev) => {
        const n = new Set(prev);
        n.delete(topic);
        return n;
      });
    }
  };

  /**
   * Hedef listesi (lib/publish-targets.ts tablePublishPlan, sozlesme D1):
   *  - yazi SITEDE yayindaysa BOS: API yazinin yayinda oldugu aktif hedefleri secer. Eskiden
   *    varsayilan acikca gonderiliyordu ([def.id]); varsayilan sonradan degistiyse onaylanan
   *    yeniden yayin varsayilanda ikinci bir kopya aciyordu (R10/R17).
   *  - sitede yayinda degilse (hic yayinlanmamis ya da yalniz Markdown ZIP disa aktarimi var)
   *    etkin varsayilan hedef ACIKCA: API acik listeyi aynen uygular. 11. turda her zaman
   *    bos liste gidiyordu; yalniz ZIP disa aktarimi olan yazi yeniden disa aktariliyor,
   *    varsayilan WordPress hedefine hic yazilmiyordu (S25).
   * Karar tiklama anindaki yazidan verilir (tablonun listesi eski olabilir: yazi bu arada
   * baska sekmede yayinlanmis olabilir); okunamazsa tablodaki kayit kullanilir.
   * overwrite: yalniz yayincinin az once 'live_entry_edited' dedigi hedef(ler), onay
   * penceresinden sonra (sozlesme C1/C2) — o zaman hedefler acikca gonderilir.
   */
  const publish = async (articleId: string, overwrite?: { targetIds: string[] }) => {
    setPublishing((prev) => new Set(prev).add(articleId));
    try {
      const [targets, fresh] = await Promise.all([
        api.listPublishTargets(siteId) as Promise<any[]>,
        api.getArticle(siteId, articleId).catch(() => null),
      ]);
      const article = fresh ?? (articles ?? []).find((a) => a?.id === articleId);
      const plan = tablePublishPlan(article?.publishedTo, targets);
      if (!overwrite && plan.kind === 'no_target') {
        toast.error(plan.message);
        return;
      }
      const job = overwrite
        ? await api.publishArticle(siteId, articleId, overwrite.targetIds, undefined, true)
        : await api.publishArticle(siteId, articleId, plan.kind === 'publish' ? plan.targetIds : []);
      toast.message(overwrite ? 'Üzerine yazma kuyruğa alındı' : 'Yayın kuyruğa alındı', {
        description: overwrite || plan.kind !== 'publish'
          ? 'Sonucu burada göstereceğiz.'
          : tablePublishDescription(plan),
      });
      onRefresh();
      // Sonuc is kaydindan: yayinlandi / atlandi (kopya acilmadi) / hata — hata metni
      // API'den, oldugu gibi (lib/publish-result.ts). Eskiden yalniz "Yayin baslatildi" deniyordu.
      const snap = job?.dbJobId ? await pollJob(() => api.getJob(job.dbJobId), { isAlive: () => alive.current }) : null;
      if (!alive.current) return;
      // Ad sonucun kendi hedefinden: eskiden yalniz varsayilan hedefin adi biliniyordu
      const nameOf = (r: { targetId: string; targetType?: string }) => targetDisplayName(targets, r.targetId, r.targetType);
      const view = publishOutcomeView(publishJobOutcome(snap), nameOf);
      for (const n of view.notices) showNotice(n);
      if (view.remoteEdited) {
        const edited = view.remoteEdited.results;
        const { notice } = view.remoteEdited;
        // Yazi WordPress'te elle duzenlenmis, RanksUp uzerine yazmadi: musteri isterse
        // onay penceresinden sonra uzerine yazar (onaysiz hicbir sey ezilmez)
        toast.warning(notice.title, {
          description: notice.description,
          duration: 30_000,
          action: overwrite ? undefined : {
            label: 'Üzerine yaz…',
            onClick: () => { void overwriteRemote(articleId, edited.map((r) => r.targetId), edited.map(nameOf)); },
          },
        });
      }
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      if (alive.current) {
        setPublishing((prev) => {
          const next = new Set(prev);
          next.delete(articleId);
          return next;
        });
      }
    }
  };

  /** "WordPress'teki degisikliklerin uzerine yaz" — musterinin kendi duzenlemeleri gider; once onay */
  const overwriteRemote = async (articleId: string, targetIds: string[], names: string[]) => {
    if (targetIds.length === 0) return;
    const c = overwriteRemoteEditsConfirm(names);
    if (!(await confirm({ ...c, danger: true }))) return;
    await publish(articleId, { targetIds });
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
      else if (a.status === 'SCHEDULED' && isPlanLocked(a)) {
        // Deneme hakki doldu: plan yukseltilene kadar uretilmez (karar sunucudan, lib/plan-lock.ts)
        state = 'locked';
      }
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
        // Durumdan bagimsiz: yeniden yazilip onay bekleyen (Hazir) yazi da eski surumle yayinda olabilir
        manualUpdate: manualUpdateBadge(a.publishedTo),
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
    //   6) Takvimde (gelecek)
    //   7) Kilitli (plan yükseltilince yazılır)
    //   8) Başarısız
    const order: Record<Row['state'], number> = {
      suggested: 0,
      generating: 1,
      editing: 2,
      ready: 3,
      queued: 4,
      published: 5,
      scheduled: 6,
      locked: 7,
      failed: 8,
    };
    return all.sort((a, b) => order[a.state] - order[b.state]);
  }, [articles, tier1]);

  const visibleRows = stateFilter && stateFilter.length > 0 ? rows.filter((r) => stateFilter.includes(r.state)) : rows;

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
        // Article generation başlangıç zamanı — F5 sonrası bile doğru pozisyondan devam.
        // Inflight article'ın updatedAt'i GENERATING'e geçtiği an = pipeline başlangıcı.
        const startedAt = inflightArticle?.updatedAt ?? inflightArticle?.createdAt;
        return (
          <PipelineProgress
            title={
              showTopic
                ? `Makale üretiliyor: "${showTopic.slice(0, 60)}…"`
                : 'Topic Engine yenileniyor'
            }
            steps={showTopic ? PIPELINE_STEPS.article : PIPELINE_STEPS.topicEngine}
            running
            startedAt={startedAt}
          />
        );
      })()}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                İçerik Akışı
                <span className="inline-flex items-center gap-1 text-label font-normal text-warning">
                  <span className="h-2 w-0.5 bg-warning/70 rounded" /> AI önerisi
                </span>
                <span className="inline-flex items-center gap-1 text-label font-normal text-brand">
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
          {visibleRows.length === 0 ? (
            <div className="p-12 text-center border-t">
              <p className="text-sm text-muted-foreground">{rows.length === 0 ? 'Henüz içerik yok.' : 'Bu filtrede içerik yok.'}</p>
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
                  {visibleRows.map((row) => {
                    const cfg = STATE_CONFIG[row.state];
                    const Icon = cfg.Icon;
                    const isInflight = row.state === 'generating' || row.state === 'editing';
                    const isThisGenerating = generatingTopics.has(row.topic);
                    // Görsel ayrım: AI önerisi mi yoksa üretilmiş/üretiliyor article mı?
                    // Sol border accent kullanılır — kullanıcı tek bakışta anlasın.
                    const isAISuggestion = row.state === 'suggested';
                    const leftAccent = isAISuggestion
                      ? 'border-l-4 border-l-warning/70'
                      : isInflight
                        ? 'border-l-4 border-l-brand'
                        : row.state === 'published'
                          ? 'border-l-4 border-l-success/70'
                          : row.state === 'scheduled'
                            ? 'border-l-4 border-l-info/50'
                            : row.state === 'locked'
                              ? 'border-l-4 border-l-border'
                            : row.state === 'ready'
                              ? 'border-l-4 border-l-success/70'
                              : 'border-l-4 border-l-transparent';

                    return (
                      <tr
                        key={row.key}
                        className={cn(
                          'transition-colors',
                          leftAccent,
                          isInflight && 'bg-brand/5',
                          isAISuggestion && 'bg-warning/[0.025] hover:bg-warning/5',
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
                              className="cursor-grab active:cursor-grabbing inline-flex items-start gap-2 -mx-1 -my-0.5 px-2 py-1 rounded hover:bg-warning/5 hover:ring-1 hover:ring-warning/30 transition-all"
                              title="Sürükleyip takvime bırak"
                            >
                              <span className="text-warning mt-0.5 select-none" aria-hidden>⠿</span>
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
                                  ? 'hover:bg-warning/5 hover:ring-1 hover:ring-warning/30'
                                  : 'hover:bg-info/5 hover:ring-1 hover:ring-info/30',
                              )}
                              title={row.state === 'queued' ? 'Sürükleyip takvime bırak (tarih ata)' : 'Sürükleyip takvimde başka güne taşı'}
                            >
                              <span
                                className={cn('mt-0.5 select-none', row.state === 'queued' ? 'text-warning' : 'text-info')}
                                aria-hidden
                              >⠿</span>
                              <span className="font-medium leading-snug">{row.topic}</span>
                            </div>
                          ) : row.state === 'locked' ? (
                            // Gercek baslik gorunur; govde yerine bulanik yer tutucu + "yukseltince yazilir"
                            <div>
                              <div className="font-medium leading-snug">{row.topic}</div>
                              <LockedRowPreview seed={row.articleId ?? row.key} />
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
                                'text-label mt-0.5 font-mono',
                                sameMonth ? 'text-muted-foreground' : 'text-warning font-semibold',
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
                            <div className="text-label text-muted-foreground mt-0.5 font-mono">
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
                              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-label font-semibold border',
                              cfg.color,
                              cfg.bg,
                              cfg.border,
                            )}
                          >
                            <Icon className={cn('h-3 w-3', isInflight && 'animate-spin')} />
                            {cfg.label}
                          </span>
                          {row.manualUpdate && (
                            <Badge variant="warning" className="mt-1 flex w-fit text-label" title={row.manualUpdate.title}>
                              {row.manualUpdate.label}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          {row.state === 'suggested' && (
                            <div className="flex items-center justify-end gap-1.5">
                              {isThisGenerating ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand px-3 py-1.5">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Üretiliyor…
                                </span>
                              ) : allowance.locked && !generationOnlyLock ? (
                                // Hak bitti: "Takvime" de "Uret" de 403 donerdi — tek kilitli dugme
                                <LockedGenerateButton lock={allowance} />
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
                                    // Denemede de calisir: sunucu deneme hesabinda bekleyen konulari kalan haktan
                                    // ayirmaz (otomasyon denemede uretmez; api article-scheduler scheduleTopic)
                                    title="Takvime ekle. Ücretli planlarda yayın saati gelince kendiliğinden üretilir (Yarı otomatikte yayından önce onayını bekler). Ücretsiz denemede kendiliğinden üretilmez; takvimdeki konuyu “Şimdi üret” ile sen başlatırsın."
                                  >
                                    <Calendar className="h-3.5 w-3.5 mr-1" /> Takvime
                                  </Button>
                                  {generationOnlyLock ? (
                                    <LockedGenerateButton lock={allowance} />
                                  ) : (
                                    <Button
                                      size="sm"
                                      onClick={() => generate(row.topic)}
                                      disabled={isThisGenerating}
                                      title="Şimdi üret (anında pipeline)"
                                    >
                                      Üret →
                                    </Button>
                                  )}
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
                                ) : allowance.locked ? (
                                  // Hak bitti. Bilinen kucuk yanlis kilit: hakki daha once dusulmus,
                                  // takvime geri donmus yazi sunucuda yeniden dusulmez ama panelde
                                  // bu bilgi yok; yazi saati gelince yine de uretilir.
                                  <LockedGenerateButton lock={allowance} />
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
                                      } finally {
                                        refreshArticleAllowance(ownerId);
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
                          {row.state === 'locked' && (
                            // Uretim dugmesi YOK ("Simdi uret" deneme hakki dolu oldugu icin 403 donerdi):
                            // yukseltme ve kilitli yazinin sayfasi
                            <div className="flex items-center justify-end gap-1.5">
                              <PlanUpgradeButton />
                              {row.articleId && (
                                <Link href={`/sites/${siteId}/articles/${row.articleId}`}>
                                  <Button size="sm" variant="outline" title="Kilitli yazıyı aç">
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                </Link>
                              )}
                            </div>
                          )}
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
                                disabled={!!row.articleId && publishing.has(row.articleId)}
                              >
                                {row.articleId && publishing.has(row.articleId) ? '…' : 'Yayınla →'}
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
                              {row.articleId && (
                                <ArticleVideoButton siteId={siteId} article={{ id: row.articleId, title: row.topic, status: 'PUBLISHED' }} label="Video" />
                              )}
                              <Link href={`/sites/${siteId}/articles/${row.articleId}`}>
                                <Button size="sm" variant="outline">
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </Link>
                            </div>
                          )}
                          {row.state === 'failed' && (
                            <span className="text-xs text-danger italic">başarısız</span>
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
              // 403 (hak doldu) geldiyse dugmeler kilitlensin
              refreshArticleAllowance(ownerId);
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
