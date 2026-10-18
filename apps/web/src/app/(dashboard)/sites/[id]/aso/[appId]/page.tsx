'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import {
  ArrowDown, ArrowRight, ArrowUp, ChevronDown, ExternalLink, Gauge, ListTodo, MessageSquare, RefreshCw, Search,
  TrendingUp, Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { SENTIMENT_LABEL, label } from '@/lib/labels';
import { siteHref } from '@/lib/site-routes';
import { formatNum } from '@/lib/format';
import { fadeUp, staggerContainer } from '@/lib/motion-presets';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/async-state';
import { DataTable, type Column } from '@/components/ui/data-table';
import { InfoTooltip } from '@/components/info-tooltip';
import { cn } from '@/lib/utils';
import { useAsoApp, useAudit, useReviewStats } from '../_components/app-context';
import { AppIcon, Rating, Stars } from '../_components/app-bits';
import { CREATIVE_FIELDS, findingLabel, findingMessage } from '../_components/findings';
import { keywordPerformance, mergeScore, scoreTone, targetKeywords, type HealthResult } from '../_components/score';
import { SENTIMENT_BADGE, STORE_LABEL } from '../_components/types';

type Action = { id: string; title: string; detail?: string; href: string; tone: 'danger' | 'warning' | 'info' };

/**
 * Uygulama genel bakışı — TEK birleşik skor, sıra hareketleri, son yorumlar
 * ve sıradaki işler. Eski /health sayfası buraya yönlenir.
 */
export default function AsoAppOverviewPage() {
  const { siteId, app, base, asc } = useAsoApp();
  const audit = useAudit();
  const reviews = useReviewStats();
  const keywords = app.keywords ?? [];

  const [health, setHealth] = useState<HealthResult | null>(null);
  const [healthError, setHealthError] = useState<unknown>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  const kwSignature = keywords.map((k) => `${k.id}:${k.currentRank ?? ''}`).join(',');
  const runHealth = async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      setHealth(await api.asoCalculateScore(siteId, app.id, {
        targetKeywords: targetKeywords(keywords),
        keywordPerformance: keywordPerformance(keywords),
      }));
    } catch (err) {
      setHealthError(err);
    } finally {
      setHealthLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { runHealth(); }, [siteId, app.id, kwSignature]);

  const merged = mergeScore(audit.data, health, keywords);
  const tone = scoreTone(merged.score);
  const scoreLoading = (audit.loading && !audit.data) || (healthLoading && !health);

  // Sıra hareketleri — en büyük değişim üstte
  const movers = keywords
    .filter((k) => k.previousRank != null && k.currentRank != null && k.previousRank !== k.currentRank)
    .map((k) => ({ k, d: k.previousRank! - k.currentRank! }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 5);

  const recent: any[] = reviews.data?.recentReviews ?? [];

  // Sıradaki işler
  const actions: Action[] = [];
  if (keywords.length === 0) {
    actions.push({ id: 'kw-add', title: 'Anahtar kelime ekle', detail: 'Sıralama takibi ve AI metin önerisi kelimelerle başlar.', href: `${base}/keywords`, tone: 'danger' });
  } else if (!keywords.some((k) => k.lastCheckedAt)) {
    actions.push({ id: 'kw-rank', title: 'Sıraları ölç', detail: `${keywords.length} kelimenin mağazadaki sırası henüz ölçülmedi.`, href: `${base}/keywords`, tone: 'warning' });
  }
  for (const f of (audit.data?.findings ?? []).filter((x) => x.severity === 'error').slice(0, 3)) {
    actions.push({
      id: `f-${f.store}-${f.field}`,
      title: `${findingLabel(f)} (${f.store === 'BOTH' ? 'Hepsi' : STORE_LABEL[f.store]})`,
      detail: findingMessage(f),
      href: CREATIVE_FIELDS.has(f.field) ? `${base}/creatives` : `${base}/metadata`,
      tone: 'danger',
    });
  }
  if (reviews.data && recent.length === 0) {
    actions.push({ id: 'rv', title: 'Yorumları çek', detail: 'Duygu analiziyle kullanıcıların neyi sevip neyden şikâyet ettiğini gör.', href: `${base}/reviews`, tone: 'info' });
  }
  for (const r of (health?.recommendations ?? []).filter((x) => x.priority === 'high' && (x.category === 'ratings_reviews' || x.category === 'keyword_performance'))) {
    if (r.category === 'keyword_performance' && !keywords.some((k) => k.lastCheckedAt)) continue;
    actions.push({
      id: `h-${r.category}`,
      title: r.action,
      detail: r.details,
      href: r.category === 'ratings_reviews' ? `${base}/reviews` : `${base}/keywords`,
      tone: 'warning',
    });
  }
  if (app.appStoreId && !asc.loading && !asc.match) {
    actions.push({ id: 'asc', title: "App Store Connect'i bağla", detail: 'Metni ve ekran görüntülerini doğrudan uygula, yorumlara yanıt ver.', href: `${siteHref(siteId, 'aso')}/connect`, tone: 'info' });
  }

  return (
    <div className="space-y-5">
      <motion.div className="grid gap-4 lg:grid-cols-3" variants={staggerContainer} initial="hidden" animate="show">
        {/* Birleşik skor */}
        <motion.div variants={fadeUp}>
          <Card className="h-full">
            <CardHeader className="pb-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Gauge className="h-4 w-4 text-brand" aria-hidden /> ASO skoru
                <InfoTooltip text="Eldeki boyutların ortalaması: mağaza sayfası denetimi, puan ve yorumlar, izlenen anahtar kelimelerin gerçek sıraları. Dönüşüm verisi olmadığı için skora katılmaz; son 30 günün yorum sayısı kesin bilinmiyorsa (yorum çekilmediyse, son çekim 48 saatten eskiyse ya da tek çekimin sınırına dayandıysa) sıfır ya da eksik sayılmaz, hesaba katılmaz." />
              </h3>
            </CardHeader>
            <CardContent className="space-y-4">
              {scoreLoading ? (
                <Skeleton className="h-28" />
              ) : audit.error && healthError ? (
                <ErrorState error={audit.error} onRetry={() => { audit.reload(); runHealth(); }} />
              ) : (
                <>
                  <div className="flex items-end gap-2">
                    <span className={cn('text-5xl font-semibold tabular-nums leading-none tracking-tight', tone.text)}>{merged.score ?? '—'}</span>
                    <span className="pb-1 text-label text-muted-foreground">/ 100 · {tone.label}</span>
                  </div>
                  <ul className="space-y-2.5">
                    {merged.parts.map((p) => {
                      const t = scoreTone(p.score);
                      return (
                        <li key={p.key}>
                          <div className="mb-1 flex items-center justify-between text-label">
                            <span>{p.label}</span>
                            <span className={cn('tabular-nums', p.score == null ? 'text-muted-foreground' : t.text)}>
                              {p.score ?? p.note ?? 'veri yok'}
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                            <div className={cn('h-full rounded-full', t.bar)} style={{ width: `${p.score ?? 0}%` }} />
                          </div>
                          {p.detail && <p className="mt-1 text-label text-muted-foreground">{p.detail}</p>}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Sıradaki işler */}
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ListTodo className="h-4 w-4 text-brand" aria-hidden /> Sıradaki işler
              </h3>
            </CardHeader>
            <CardContent>
              {scoreLoading && actions.length === 0 ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
              ) : actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Acil iş yok. Metni iyileştirmek için Metadata sekmesinden AI önerisi alabilirsin.</p>
              ) : (
                <ul className="divide-y">
                  {actions.slice(0, 5).map((a) => (
                    <li key={a.id}>
                      <Link href={a.href} className="group flex items-start gap-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                        <span
                          className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.tone === 'danger' ? 'bg-danger' : a.tone === 'warning' ? 'bg-warning' : 'bg-info')}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium group-hover:text-brand">{a.title}</span>
                          {a.detail && <span className="block text-label text-muted-foreground">{a.detail}</span>}
                        </span>
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-brand" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Sıra hareketleri */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-brand" aria-hidden /> Sıra hareketleri</h3>
            <Link href={`${base}/keywords`} className="text-label text-brand hover:underline">Tüm kelimeler</Link>
          </CardHeader>
          <CardContent>
            {movers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {keywords.length === 0 ? 'Henüz anahtar kelime yok.' : 'Henüz sıra değişimi yok — iki ölçümden sonra burada görünür.'}
              </p>
            ) : (
              <ul className="divide-y">
                {movers.map(({ k, d }) => (
                  <li key={k.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{k.keyword}</span>
                    <Badge variant="outline" className="px-1.5 text-label">{STORE_LABEL[k.store]}</Badge>
                    <span className="w-12 text-right tabular-nums">#{k.currentRank}</span>
                    <span className={cn('inline-flex w-12 items-center justify-end gap-0.5 font-medium tabular-nums', d > 0 ? 'text-success' : 'text-danger')}>
                      {d > 0 ? <ArrowUp className="h-3 w-3" aria-label="yükseldi" /> : <ArrowDown className="h-3 w-3" aria-label="düştü" />}
                      {Math.abs(d)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Son yorumlar */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="h-4 w-4 text-brand" aria-hidden /> Son yorumlar</h3>
            <Link href={`${base}/reviews`} className="text-label text-brand hover:underline">Tüm yorumlar</Link>
          </CardHeader>
          <CardContent>
            {reviews.loading && !reviews.data ? (
              <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : reviews.error && !reviews.data ? (
              <ErrorState error={reviews.error} onRetry={reviews.reload} />
            ) : recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Henüz yorum çekilmedi.</p>
            ) : (
              <ul className="divide-y">
                {recent.slice(0, 3).map((r) => (
                  <li key={r.id} className="py-2.5">
                    <div className="mb-0.5 flex flex-wrap items-center gap-2">
                      <Stars rating={r.rating} />
                      {r.sentiment && (
                        <Badge variant={SENTIMENT_BADGE[r.sentiment] ?? 'secondary'} className="px-1.5 text-label">{label(SENTIMENT_LABEL, r.sentiment)}</Badge>
                      )}
                      <span className="ml-auto text-label text-muted-foreground">{STORE_LABEL[r.store as 'IOS' | 'ANDROID'] ?? r.store}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{r.title ? <span className="font-medium text-foreground">{r.title} — </span> : null}{r.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <CompetitorsSection siteId={siteId} defaultCategory={app.category ?? ''} country={app.country} />
    </div>
  );
}

type Competitor = {
  app_name?: string; developer?: string; category?: string; rating: number; ratings_count: number;
  icon_url?: string; app_store_url?: string; price: string;
};

/** Kategori rakipleri (eski /health sayfasından) — iTunes aramasıyla */
function CompetitorsSection({ siteId, defaultCategory, country }: { siteId: string; defaultCategory: string; country: string }) {
  const [category, setCategory] = useState(defaultCategory);
  const [rows, setRows] = useState<Competitor[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!category.trim()) return;
    setLoading(true);
    try {
      const res = await api.asoListCompetitors(siteId, category.trim(), country || 'tr', 10);
      setRows(res.results ?? []);
    } catch (err: any) {
      toast.error(`Rakipler getirilemedi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const columns: Column<Competitor>[] = [
    {
      key: 'app',
      header: 'Uygulama',
      sortValue: (c) => c.app_name ?? '',
      cell: (c) => (
        <div className="flex min-w-0 items-center gap-2">
          <AppIcon src={c.icon_url} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-medium">{c.app_name ?? '—'}</div>
            <div className="truncate text-label text-muted-foreground">{c.category}</div>
          </div>
        </div>
      ),
    },
    { key: 'dev', header: 'Geliştirici', hideBelow: 'md', cell: (c) => <span className="text-muted-foreground">{c.developer ?? '—'}</span> },
    { key: 'rating', header: 'Puan', align: 'right', sortValue: (c) => c.rating ?? 0, cell: (c) => <Rating value={c.rating ?? 0} /> },
    { key: 'count', header: 'Değerlendirme', align: 'right', hideBelow: 'lg', sortValue: (c) => c.ratings_count ?? 0, cell: (c) => formatNum(c.ratings_count ?? 0) },
    { key: 'price', header: 'Fiyat', hideBelow: 'sm', cell: (c) => c.price ?? 'Ücretsiz' },
    {
      key: 'link',
      header: <span className="sr-only">Bağlantı</span>,
      align: 'right',
      cell: (c) => c.app_store_url ? (
        <a href={c.app_store_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-label text-brand hover:underline">
          App Store <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : null,
    },
  ];

  return (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
        <Users className="h-4 w-4 text-brand" aria-hidden />
        <span className="text-sm font-semibold">Kategori rakipleri</span>
        <span className="text-label text-muted-foreground">App Store'daki en iyi uygulamalarla kıyasla</span>
        <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 border-t p-4">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); load(); }}>
          <label htmlFor="comp-cat" className="sr-only">Kategori</label>
          <Input
            id="comp-cat"
            placeholder="Kategori (ör. productivity, finance, fitness)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="min-w-[200px] flex-1 sm:max-w-sm"
          />
          <Button type="submit" size="sm" disabled={loading || !category.trim()}>
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
            {loading ? 'Aranıyor…' : 'Bul'}
          </Button>
        </form>
        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : rows == null ? (
          <p className="text-sm text-muted-foreground">Kategori yaz ve "Bul"a bas — App Store araması üzerinden çekilir.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu kategoride sonuç bulunamadı.</p>
        ) : (
          <DataTable caption="Kategori rakipleri" columns={columns} rows={rows} rowKey={(c) => `${c.app_name}-${c.developer}`} />
        )}
      </div>
    </details>
  );
}
