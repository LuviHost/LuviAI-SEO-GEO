'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { FileText, Globe, MessageSquare, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { formatNum } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/async-state';
import { StatusBanner } from '@/components/ui/status-banner';

/**
 * Kota ucunun (api billing.controller getQuota) yaniti. `chat` ve `budget.exempt`
 * 11.11.2026'da eklendi; eski API'de yoklar, bu yuzden istege bagli okunur.
 */
type Quota = Awaited<ReturnType<typeof api.getUserQuota>> & {
  /** Panel sohbeti (Asistan) mesaj hakki; unlimited: ADMIN, lifetime: deneme (toplam hak) */
  chat?: { used: number; limit: number; remaining: number; unlimited: boolean; lifetime: boolean } | null;
  budget?: { exempt?: boolean };
};

/**
 * Aylik kotalar + AI butce uyarisi. %70'te uyari, %90'da tehlike tonu.
 * Yuklenirken iskelet, hata olursa tekrar dene — eskiden veri gelene kadar
 * null donup bolum sonradan "patliyordu".
 */
export function QuotaMonitor() {
  const { data: session, status } = useSession();
  const userId = (session?.user as any)?.id as string | undefined;
  const [data, setData] = useState<Quota | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    if (!userId) return;
    api.getUserQuota(userId)
      .then((d) => { setData(d as Quota); setError(null); })
      .catch((e) => setError(e));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [userId, load]);

  if (error && !data) return <ErrorState error={error} onRetry={load} />;
  if (!data) {
    // Oturum yoksa (beklenmez) iskelet sonsuza dek donmesin
    if (status === 'unauthenticated') return null;
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-busy="true" aria-label="Kotalar yükleniyor">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[68px]" />)}
      </div>
    );
  }

  // Eksik ekseni ATLA, patlama: API bir ekseni biraktiginda (eski 'videos' gibi)
  // tek bir undefined tum /sites/[id] sayfasini error boundary'ye dusuruyordu.
  // Makale ekseni yalniz makale hakki OLAN planda gosterilir (11.11.2026: Baslangic'ta makale
  // uretimi yok, limit 0). Eskiden o hesapta "Makale 0/0" ve bos bir cubuk cikiyordu.
  const items = [
    data.articles && data.articles.limit > 0 && {
      key: 'articles', icon: FileText, label: 'Makale',
      used: data.articles.limit - data.articles.remaining, limit: data.articles.limit,
    },
    data.aiRuns && {
      key: 'aiRuns', icon: Sparkles, label: 'AI çalıştırma',
      used: data.aiRuns.used, limit: data.aiRuns.limit,
    },
    data.sites && {
      key: 'sites', icon: Globe, label: 'Site',
      used: data.sites.current, limit: data.sites.limit,
    },
    // Asistan mesaji hakki (plans.ts chatMessagesPerMonth). ADMIN'de sinir yok: kart gosterilmez.
    data.chat && !data.chat.unlimited && data.chat.limit > 0 && {
      key: 'chat', icon: MessageSquare, label: 'Asistan mesajı',
      used: data.chat.used, limit: data.chat.limit,
    },
  ].filter(Boolean) as Array<{ key: string; icon: typeof FileText; label: string; used: number; limit: number }>;

  const budget = data.budget;
  // ADMIN butceye takilmaz (api checkAiCostBudget exempt): durmayacak isler icin uyari gosterilmez
  const showBudgetWarn = !!budget && !budget.exempt && (budget.warn || budget.hardBlock);

  return (
    <div className="space-y-3">
      {showBudgetWarn && (
        <StatusBanner
          tone={budget.hardBlock ? 'danger' : 'warning'}
          title={budget.hardBlock ? `Aylık AI bütçen doldu (%${budget.pct})` : `AI bütçenin %${budget.pct}'i kullanıldı`}
        >
          {/* Butce (api QuotaService SPEND_CAP_USD) 11.11.2026'dan beri AI gorunurluk olcumu
              disindaki her AI harcamasini sayar ve dolunca sunlari durdurur: makale uretimi
              (kullanicinin baslattigi + takvim / otomatik: consumeArticleAllowance,
              pipeline.service), makale cevirisi (translator.service), Asistan (chat.service),
              gorsel alt metni onerisi (image-alt-suggest.service) ve App Store yorum yaniti
              taslagi (asc-review-reply.service). Olcum sayilmaz ve durmaz. Eski metin "makale
              üretimi ve AI ölçümü kendi kotalarıyla sürer" diyordu; makale icin artik yanlis.
              "Ücretli planlarda": deneme butcesi yenilenmez. public-docs.spec.ts cagiran
              listesini ve bu metni denetler. */}
          ${budget.used.toFixed(2)} / ${budget.cap.toFixed(2)} ·{' '}
          {budget.hardBlock
            ? 'Makale üretimi, makale çevirisi ve Asistan durdu; görsel alt metni önerisi ve App Store yorum yanıtı taslağı da bekler. AI görünürlük ölçümü etkilenmez, kendi kotasıyla sürer. Ücretli planlarda bütçe yeni ayda sıfırlanır.'
            : 'Bütçe dolarsa makale üretimi, makale çevirisi ve Asistan durur; görsel alt metni önerisi ve App Store yorum yanıtı taslağı da bekler. AI görünürlük ölçümü etkilenmez.'}
        </StatusBanner>
      )}

      <div className={cn('grid grid-cols-1 gap-3', items.length > 3 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3')}>
        {items.map((it) => {
          const pct = it.limit > 0 ? Math.min(100, Math.round((it.used / it.limit) * 100)) : 0;
          const tone = pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'brand';
          return (
            <Card key={it.key} className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="v-rail flex items-center gap-1.5">
                  <it.icon
                    className={cn('h-3.5 w-3.5', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted-foreground')}
                    aria-hidden
                  />
                  {it.label}
                </span>
                <span className="text-label">
                  <span className="font-medium tabular-nums">{formatNum(it.used)}</span>
                  <span className="text-muted-foreground">/{formatNum(it.limit)}</span>
                </span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={`${it.label} kotası`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <div
                  className={cn('h-full rounded-full transition-all', tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-foreground')}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
