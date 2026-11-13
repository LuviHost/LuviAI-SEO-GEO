'use client';

import { Activity } from 'lucide-react';
import { useSiteContext } from '../site-context';
import { SectionHeader } from '@/components/ui/section-header';
import { Card, CardContent } from '@/components/ui/card';
import { TrackerInstall } from '@/components/tracker-install';
import { CrawlerHitsPanel } from '@/components/crawler-hits-panel';
import { AiZiyaretciler } from '@/components/ai-ziyaretciler';

/**
 * Bot Takibi — tek satir kodla kurulan izleme: kod, kodu indiren botlar ve AI'dan gelen
 * ziyaretciler AYNI sayfada (13.11.2026, sahip: "tek menude birlestirelim"). Eskiden kod
 * Baglantilar'da, sonuclari GEO Lab'in iki sekmesinde ve Gorunurluk sayfasindaydi.
 * Sunucu tarafli, eksiksiz bot akisi ayni catidaki "Canli tarayici" sekmesinde
 * (sites/[id]/crawler-live); sekmeler lib/site-nav SITE_ROOFS'tan gelir.
 */
export default function BotTakibiPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Activity}
        title="Bot Takibi"
        description="Sitene eklediğin tek satır kod, AI asistanlarından gelen ziyaretçileri ve kodu indiren AI botlarını kaydeder. Botların tamamını anlık görmek için Canlı tarayıcı sekmesindeki sunucu kurulumunu kullan."
      />
      <TrackerInstall siteId={site.id} siteUrl={site.url} />
      <CrawlerHitsPanel siteId={site.id} />
      <Card>
        <CardContent className="space-y-3 p-6">
          <h3 className="text-panel-3">AI’dan gelen ziyaretçiler</h3>
          <AiZiyaretciler siteId={site.id} />
        </CardContent>
      </Card>
    </div>
  );
}
