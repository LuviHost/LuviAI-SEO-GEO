'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { SENTIMENT_LABEL, label } from '@/lib/labels';
import { formatNum } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { AsyncState } from '@/components/ui/async-state';
import { EmptyState } from '@/components/empty-state';
import { AscReviewsPanel } from '@/components/asc-tab';
import { cn } from '@/lib/utils';
import { useAsoApp, useReviewStats } from '../../_components/app-context';
import { Stars } from '../../_components/app-bits';
import { AscGate } from '../../_components/asc-gate';
import { SENTIMENT_BADGE, STORE_LABEL } from '../../_components/types';

export default function AsoReviewsPage() {
  const { siteId, app } = useAsoApp();
  const stats = useReviewStats();
  const [fetching, setFetching] = useState(false);
  const [limit, setLimit] = useState(10);

  const fetchReviews = async () => {
    setFetching(true);
    try {
      await api.request(`/sites/${siteId}/aso/apps/${app.id}/reviews/fetch`, {
        method: 'POST',
        body: JSON.stringify({ limit: 50, analyzeSentiment: true }),
      });
      await stats.reload();
      toast.success('Yorumlar çekildi ve analiz edildi');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setFetching(false);
    }
  };

  const grouped: Array<{ store: string; sentiment: string | null; _count: number }> = stats.data?.grouped ?? [];
  const recent: any[] = stats.data?.recentReviews ?? [];
  const bySentiment = grouped.reduce<Record<string, number>>((acc, g) => {
    const k = g.sentiment ?? 'NONE';
    acc[k] = (acc[k] ?? 0) + (typeof g._count === 'number' ? g._count : 0);
    return acc;
  }, {});
  const total = Object.values(bySentiment).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h3"
        icon={MessageSquare}
        title="Yorumlar"
        description="Her mağazadan son 50 yorumu çeker; AI duygu ve konu analizi yapar."
        actions={
          <Button size="sm" onClick={fetchReviews} disabled={fetching}>
            <RefreshCw className={cn('h-4 w-4', fetching && 'animate-spin')} aria-hidden />
            {fetching ? 'Çekiliyor ve analiz ediliyor…' : 'Yorumları çek ve analiz et'}
          </Button>
        }
      />

      <AsyncState
        loading={stats.loading && !stats.data}
        error={stats.data ? null : stats.error}
        onRetry={stats.reload}
        empty={recent.length === 0}
        emptyView={
          <EmptyState
            icon={MessageSquare}
            title="Henüz yorum çekilmedi"
            description="Mağazalardaki son yorumları çek; her biri olumlu / olumsuz / nötr olarak etiketlenir ve konulara ayrılır."
            primary={{ label: fetching ? 'Çekiliyor…' : 'Yorumları çek', onClick: fetching ? undefined : fetchReviews }}
          />
        }
      >
        <div className="space-y-4">
          {total > 0 && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-3">
                <dt className="text-label text-muted-foreground">Analiz edilen</dt>
                <dd className="text-metric-lg tabular-nums">{formatNum(total)}</dd>
              </div>
              {(['POSITIVE', 'NEGATIVE', 'NEUTRAL'] as const).map((s) => (
                <div key={s} className="rounded-lg border p-3">
                  <dt className="text-label text-muted-foreground">{SENTIMENT_LABEL[s]}</dt>
                  <dd className={cn('text-metric-lg tabular-nums', s === 'POSITIVE' && 'text-success', s === 'NEGATIVE' && 'text-danger')}>
                    {formatNum(bySentiment[s] ?? 0)}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <ul className="space-y-2">
            {recent.slice(0, limit).map((r) => (
              <li key={r.id}>
                <Card>
                  <CardContent className="p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="px-2 text-label">{STORE_LABEL[r.store as 'IOS' | 'ANDROID'] ?? r.store}</Badge>
                      <Stars rating={r.rating} />
                      {r.sentiment && (
                        <Badge variant={SENTIMENT_BADGE[r.sentiment] ?? 'secondary'} className="px-2 text-label">
                          {label(SENTIMENT_LABEL, r.sentiment)}
                        </Badge>
                      )}
                      {Array.isArray(r.topics) && r.topics.map((t: string) => (
                        <Badge key={t} variant="secondary" className="px-2 text-label font-normal">{t}</Badge>
                      ))}
                      <span className="ml-auto text-label text-muted-foreground">{r.author ?? 'Anonim'}</span>
                    </div>
                    {r.title && <p className="text-sm font-medium">{r.title}</p>}
                    <p className="text-sm text-muted-foreground">{r.text}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          {recent.length > limit && (
            <Button size="sm" variant="ghost" onClick={() => setLimit(limit + 10)}>
              Daha fazla göster ({recent.length - limit})
            </Button>
          )}
        </div>
      </AsyncState>

      <section aria-labelledby="rv-asc" className="space-y-3">
        <h4 id="rv-asc" className="font-semibold">App Store Connect&apos;te yanıtla</h4>
        <AscGate purpose="App Store yorumlarına yanıt vermek">
          {(ascApp) => (
            <Card>
              <CardContent className="p-4">
                <AscReviewsPanel ascAppId={ascApp.id} className="mt-0 border-t-0 pt-0" />
              </CardContent>
            </Card>
          )}
        </AscGate>
      </section>
    </div>
  );
}
