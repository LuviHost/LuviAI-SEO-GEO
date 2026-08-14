'use client';
import { useSiteContext } from '../site-context';
import { SiteReportPanel } from '@/components/site-report-panel';
import { AuditReportsPanel } from '@/components/audit-reports-panel';
import { RaporGecmisiPanel } from '@/components/rapor-gecmisi-panel';
import { FileBarChart } from 'lucide-react';

export default function ReportPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-8">
      <div className="flex items-start gap-3 print:hidden">
        <div className="h-10 w-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 grid place-items-center">
          <FileBarChart className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Raporlar</h2>
          <p className="text-sm text-muted-foreground">
            Performans raporu ve tarama geçmişi — trafik, yayınlanan içerik, AI görünürlüğü ve site skorunun zaman içindeki değişimi.
          </p>
        </div>
      </div>

      {/* Bolum basliklari acik olsun ki hangi raporun nerede oldugu karismasin */}
      {/*
        Kalici rapor EN USTTE: kullanicinin asil istedigi is bu — donem secip
        rapor calistirmak ve gecmisi gormek. Asagidaki canli paneller
        "su an ne durumdayim" sorusunu cevapliyor, bu ise "ne kadar buyudum".
      */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground print:hidden">
          Dönem raporu — SEO · GEO · ASO · ASA
        </h3>
        <RaporGecmisiPanel siteId={site.id} />
      </section>

      <section className="space-y-3 print:hidden">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Canlı performans
        </h3>
        <SiteReportPanel siteId={site.id} site={site} />
      </section>

      <section className="space-y-3 print:hidden">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Tarama raporları
        </h3>
        <AuditReportsPanel siteId={site.id} />
      </section>
    </div>
  );
}
