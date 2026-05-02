'use client';
import { useState, useEffect, useRef } from 'react';
import { useSiteContext } from '../site-context';
import { SnippetPanel } from '@/components/site-flow-stepper';
import { BulkSnippetScan } from '@/components/bulk-snippet-scan';
import { RelatedLinks } from '@/components/empty-state';
import { FileText, ShieldCheck, Sparkles, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 grid place-items-center">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Sayfa SEO İyileştir</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Önce site URL'iyle <strong>tüm alt sayfaları toplu tara</strong>, eksik olan sayfaları gör.
            Sonra istediğin sayfada AI ile <strong>title, meta, OG, FAQ</strong> önerisi üret + tek tıkla uygula.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400 mb-2">İki adım — tek panel</p>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div>
            <strong>1. Toplu Tara</strong>
            <p className="text-xs text-muted-foreground mt-0.5">Site URL'in gir → 30 sayfa otomatik taranır → her birinin SEO durumu tablo halinde gelir (skor, title, meta, OG, schema).</p>
          </div>
          <div>
            <strong>2. AI ile İyileştir</strong>
            <p className="text-xs text-muted-foreground mt-0.5">Tablodaki sayfada "Üret" tıkla → AI öneriler çıkar → WordPress/FTP/manuel olarak uygula.</p>
          </div>
        </div>
      </div>

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
                <Sparkles className="h-4 w-4 text-brand" /> Tek Sayfa AI Üretici
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
