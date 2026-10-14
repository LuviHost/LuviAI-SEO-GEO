'use client';
import { useSiteContext } from '../site-context';
import { PublishTargetsManager } from '@/components/settings-tab';
import { Send } from 'lucide-react';
import { SectionHeader } from '@/components/ui/section-header';

export default function PublishTargetsPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <SectionHeader icon={Send} title="Yayın Hedefleri" description="Üretilen içerikler bu hedeflere yayınlanır. WordPress, FTP, SFTP, GitHub ve Webflow dahil 14 hedef türü desteklenir." />
      <PublishTargetsManager siteId={site.id} defaultSiteUrl={site?.url} />
    </div>
  );
}
