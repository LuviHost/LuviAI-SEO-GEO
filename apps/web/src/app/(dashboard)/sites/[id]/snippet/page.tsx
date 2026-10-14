'use client';
import { useState, useEffect, useRef } from 'react';
import { useSiteContext } from '../site-context';
import { SnippetPanel } from '@/components/site-flow-stepper';
import { BulkSnippetScan } from '@/components/bulk-snippet-scan';
import { RelatedLinks } from '@/components/empty-state';
import { FileText, ShieldCheck, Sparkles, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/ui/section-header';

export default function SnippetPage() {
  const { site } = useSiteContext();
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [showSingle, setShowSingle] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeUrl && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setShowSingle(true);
    }
  }, [activeUrl]);

  return (
    <div className="space-y-5">
      <SectionHeader icon={FileText} title="Sayfa SEO İyileştir" description="Önce sitenin sayfalarını toplu tara ve başlığı, açıklaması ya da şeması eksik olanları gör. Sonra seçtiğin sayfa için AI önerisi üretip tek tıkla uygula." />

      {/* Toplu tarama */}
      <BulkSnippetScan
        siteId={site.id}
        defaultUrl={site.url}
        onPickUrl={(url) => setActiveUrl(url)}
      />

      {/* Tek sayfa AI üretici (collapse) */}
      <Card ref={panelRef}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-base inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" /> Tek Sayfa AI Üretici
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {activeUrl ? `Aktif: ${activeUrl}` : 'Bir URL seç (tablodan veya manuel) → AI snippet üret'}
              </p>
            </div>
            {!showSingle && (
              <Button size="sm" variant="outline" onClick={() => setShowSingle(true)}>
                <ChevronDown className="h-4 w-4 mr-1" /> Aç
              </Button>
            )}
          </div>
          {showSingle && <SnippetPanel siteId={site.id} initialUrl={activeUrl ?? undefined} />}
        </CardContent>
      </Card>

      <RelatedLinks
        links={[
          { href: `/sites/${site.id}/audit`, label: 'Site Skoru', description: 'Site geneli SEO + GEO denetim', icon: ShieldCheck },
          { href: `/sites/${site.id}/visibility`, label: 'AI Görünürlük', description: 'Sayfanın AI search\'lerde alıntılanma skoru', icon: Sparkles },
        ]}
      />
    </div>
  );
}
