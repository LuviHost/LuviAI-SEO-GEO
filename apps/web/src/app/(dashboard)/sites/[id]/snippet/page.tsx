'use client';
import { useSiteContext } from '../site-context';
import { SnippetPanel } from '@/components/site-flow-stepper';
import { RelatedLinks } from '@/components/empty-state';
import { FileText, ShieldCheck, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function SnippetPage() {
  const { site } = useSiteContext();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 grid place-items-center">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Sayfa SEO İyileştir</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Sitendeki bir sayfanın URL'ini gir → AI o sayfayı analiz edip <strong>title, meta description, FAQ ve schema</strong> önerileri üretir.
            Tek tıkla WP/FTP üzerinden uygulayabilirsin.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400 mb-2">Ne işe yarar?</p>
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div>
            <strong>1. URL ver</strong>
            <p className="text-xs text-muted-foreground mt-0.5">Sitedeki bir sayfanın tam URL'ini yapıştır (örn /blog/yazi-adi).</p>
          </div>
          <div>
            <strong>2. AI analiz</strong>
            <p className="text-xs text-muted-foreground mt-0.5">Mevcut title/meta/H1/FAQ varsa skoru çıkarır, eksik veya zayıfsa önerir.</p>
          </div>
          <div>
            <strong>3. Tek tıkla uygula</strong>
            <p className="text-xs text-muted-foreground mt-0.5">Önerileri yayın hedefine (WordPress/FTP) gönderir, canlıda görünür.</p>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <SnippetPanel siteId={site.id} />
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
