'use client';
import { useSiteContext } from '../site-context';
import { SiteReportPanel } from '@/components/site-report-panel';
import { FileBarChart } from 'lucide-react';

export default function ReportPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 grid place-items-center">
          <FileBarChart className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Rapor</h2>
          <p className="text-sm text-muted-foreground">Toplam performans raporu — yayınlanan, etkileşim, ROI.</p>
        </div>
      </div>
      <SiteReportPanel siteId={site.id} site={site} />
    </div>
  );
}
