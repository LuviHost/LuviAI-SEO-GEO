'use client';
import { useState } from 'react';
import { useSiteContext } from '../site-context';
import { EmptyState, RelatedLinks } from '@/components/empty-state';
import { ContentFlowTable, type ContentRowState } from '@/components/content-flow-table';
import { FileText, Sparkles, Lightbulb, Send } from 'lucide-react';
import { StatusBanner } from '@/components/ui/status-banner';
import { LockedGenerateButton, PlanUpgradeButton } from '@/components/locked-article';
import { PLAN_LOCK_COPY, scheduledCounts } from '@/lib/plan-lock';
import { useArticleAllowance } from '@/lib/use-article-allowance';
import { FilterChip } from '@/components/ui/filter-chip';
import { SectionHeader } from '@/components/ui/section-header';
import { api } from '@/lib/api';
import { formatNum } from '@/lib/format';
import { siteHref } from '@/lib/site-routes';
import { toast } from 'sonner';

type FilterKey = 'suggested' | 'pipeline' | 'scheduled' | 'published';

// Sayfa cipleri → tablo satir durumlari
const FILTER_STATES: Record<FilterKey, ContentRowState[]> = {
  suggested: ['suggested'],
  pipeline: ['generating', 'editing', 'ready'],
  scheduled: ['scheduled', 'queued', 'locked'],
  published: ['published'],
};

export default function ArticlesPage() {
  const { site, queue, articles, refresh, onboardingMode } = useSiteContext();
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<FilterKey | null>(null);
  // Hak sitenin sahibinden duser (sunucu site.userId); tablo ayni onbellegi okur
  const allowance = useArticleAllowance(site?.userId, site?.id);

  const runEngine = async () => {
    setRunning(true);
    try {
      await api.runTopicEngineNow(site.id);
      toast.success('Yeni konular hazırlandı');
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  // Empty: hem queue boş hem hiç article yok
  const tier1 = queue?.tier1Topics ?? [];
  const usedTopics = new Set(
    (articles ?? []).map((a: any) => String(a?.topic ?? a?.title ?? '').trim().toLowerCase()).filter(Boolean),
  );
  const freshTier1 = tier1.filter((t: any) => {
    const k = String(t?.topic ?? '').trim().toLowerCase();
    return k && !usedTopics.has(k);
  });
  const isFullyEmpty = (!queue || freshTier1.length === 0) && (articles ?? []).length === 0;

  // Sayım istatistikleri
  const counts = {
    suggested: freshTier1.length,
    pipeline: (articles ?? []).filter((a: any) => ['GENERATING', 'EDITING', 'READY_TO_PUBLISH'].includes(a.status)).length,
    scheduled: (articles ?? []).filter((a: any) => a.status === 'SCHEDULED').length,
    // Deneme hakki doldugu icin plan yukseltilene kadar yazilmayacak takvim yazilari (sunucu: lockedByPlan)
    locked: scheduledCounts(articles).locked,
    published: (articles ?? []).filter((a: any) => a.status === 'PUBLISHED').length,
  };

  const FILTERS: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: 'suggested', label: 'Önerilen', count: counts.suggested },
    { key: 'pipeline', label: 'Üretimde', count: counts.pipeline },
    { key: 'scheduled', label: 'Takvimde', count: counts.scheduled },
    { key: 'published', label: 'Yayında', count: counts.published },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={FileText}
        title="İçerikler"
        description="AI önerileri, üretimdeki ve yayındaki makaleler tek listede. Önerileri takvime al ya da hemen üret."
      />

      {/* Durum sayilari artik tiklanabilir filtre — eskiden sadece gosterge ciplerdi */}
      {!isFullyEmpty && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Duruma göre filtrele">
          <FilterChip selected={filter === null} onClick={() => setFilter(null)}>
            Tümü
          </FilterChip>
          {FILTERS.map((f) => (
            <FilterChip
              key={f.key}
              selected={filter === f.key}
              onClick={() => setFilter(filter === f.key ? null : f.key)}
            >
              {f.label}
              <span className="tabular-nums text-muted-foreground">{formatNum(f.count)}</span>
            </FilterChip>
          ))}
        </div>
      )}

      {counts.locked > 0 && (
        <StatusBanner
          tone="info"
          title={`Takviminde ${formatNum(counts.locked)} makale kilitli; planını yükselttiğinde yazılır.`}
          action={<PlanUpgradeButton />}
        >
          {PLAN_LOCK_COPY.body}
        </StatusBanner>
      )}

      {/* Makale hakki bitti: uretim dugmeleri kilitli. Kilitli takvim yazisi bandi zaten
          ayni seyi soyluyorsa ikinci bant yok. */}
      {/* Deneme: makaleyi kullanici baslatir ve once yayin hedefi baglanmali (api trial-policy.ts) */}
      {allowance.reason === 'source_required' && (
        <StatusBanner
          tone="info"
          title="Ücretsiz denemede makaleyi sen başlatırsın; önce yayın hedefini bağla."
          action={<LockedGenerateButton lock={allowance} variant="outline" />}
        >
          Denemede yapay zekâ konu başlıklarını hazırlar ama makaleyi kendiliğinden yazmaz. Sitene bir yayın hedefi (WordPress, FTP vb.) bağladıktan sonra istediğin konuda “Üret” ya da “Şimdi üret” ile en fazla 2 makale üretebilirsin.
        </StatusBanner>
      )}

      {allowance.locked && allowance.reason !== 'source_required' && counts.locked === 0 && (
        <StatusBanner
          tone="info"
          title="Makale hakkın doldu; yeni üretim için planını yükselt."
          action={<PlanUpgradeButton />}
        >
          {allowance.hint}
        </StatusBanner>
      )}

      {isFullyEmpty ? (
        <EmptyState
          icon={Sparkles}
          accent="amber"
          title={running ? 'Konu motoru çalışıyor…' : 'Henüz içerik yok'}
          description={
            running
              ? 'Plan + GSC + GEO + rakip analizi → 6 öncelikli konu üretilecek (~60 sn).'
              : 'Konu motoru sitenin nişine ve rakiplerine göre 6 öneri çıkarır. Her birini takvime alabilir veya hemen üretebilirsin.'
          }
          primary={{
            label: running ? 'Çalışıyor…' : 'Konu önerisi üret',
            onClick: runEngine,
          }}
        />
      ) : (
        // "Yeni öneriler" dugmesi tablonun basliginda — sayfada ikinci kopya yok
        <ContentFlowTable
          queue={queue}
          articles={articles}
          siteId={site.id}
          ownerId={site?.userId}
          onRefresh={refresh}
          onboardingMode={onboardingMode}
          stateFilter={filter ? FILTER_STATES[filter] : null}
        />
      )}

      <RelatedLinks
        links={[
          { href: siteHref(site.id, 'publishTargets'), label: 'Yayın Hedefleri', description: 'Makaleler nereye gidecek (WP, FTP, vb.)', icon: Send },
          { href: siteHref(site.id, 'opportunities'), label: 'Fırsatlar', description: 'Sıralaması yükselebilecek sorgular için içerik üret', icon: Lightbulb },
          { href: siteHref(site.id, 'audit'), label: 'Site Skoru', description: 'SEO + GEO 14 kontrol noktası', icon: Sparkles },
        ]}
      />
    </div>
  );
}
