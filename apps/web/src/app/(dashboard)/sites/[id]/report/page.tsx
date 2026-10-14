'use client';
import { useSiteContext } from '../site-context';
import { SiteReportPanel } from '@/components/site-report-panel';
import { AuditReportsPanel } from '@/components/audit-reports-panel';
import { RaporGecmisiPanel } from '@/components/rapor-gecmisi-panel';
import { SectionHeader } from '@/components/ui/section-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, CalendarRange, FileBarChart, ScanSearch } from 'lucide-react';

/*
  Uc uzun panel alt alta yigiliydi → sekmeler. Kalici donem raporu ILK sekme:
  kullanicinin asil istedigi is bu — donem secip rapor calistirmak ve gecmisi
  gormek. "Canli performans" su anki durum, "Tarama raporlari" site skoru gecmisi.

  forceMount: sekmeler arasi gecerken panellerin secimleri/verisi kaybolmasin ve
  yazdirma davranisi eskisi gibi kalsin (yazdirilan yalniz donem raporu).
*/
const HIDE_INACTIVE = 'data-[state=inactive]:hidden';

export default function ReportPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <SectionHeader
          icon={FileBarChart}
          title="Raporlar"
          description="Dönem raporu, canlı performans ve tarama geçmişi — trafik, içerik, AI görünürlüğü ve site skorunun değişimi."
        />
      </div>

      <Tabs defaultValue="donem" className="space-y-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 print:hidden">
          <TabsList className="w-max">
            <TabsTrigger value="donem">
              <CalendarRange className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Dönem raporu
            </TabsTrigger>
            <TabsTrigger value="canli">
              <Activity className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Canlı performans
            </TabsTrigger>
            <TabsTrigger value="tarama">
              <ScanSearch className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Tarama raporları
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="donem" forceMount className={`${HIDE_INACTIVE} print:block`}>
          <p className="mb-3 text-label text-muted-foreground print:hidden">SEO · GEO · ASO · ASA</p>
          <RaporGecmisiPanel siteId={site.id} />
        </TabsContent>

        <TabsContent value="canli" forceMount className={`${HIDE_INACTIVE} print:hidden`}>
          <SiteReportPanel siteId={site.id} site={site} />
        </TabsContent>

        <TabsContent value="tarama" forceMount className={`${HIDE_INACTIVE} print:hidden`}>
          <AuditReportsPanel siteId={site.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
