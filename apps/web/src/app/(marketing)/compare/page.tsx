'use client';

import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';

interface Feature {
  name: string;
  luviai: boolean | string;
  surfer: boolean | string;
  jasper: boolean | string;
  frase: boolean | string;
}

const FEATURES: Feature[] = [
  { name: 'AI içerik üretimi', luviai: true, surfer: true, jasper: true, frase: true },
  { name: 'Türkçe optimize', luviai: true, surfer: 'kısmi', jasper: 'kısmi', frase: 'kısmi' },
  { name: 'Otomatik yayın', luviai: '14 hedef', surfer: 'WP only', jasper: false, frase: false },
  { name: 'GSC entegrasyonu', luviai: true, surfer: false, jasper: false, frase: true },
  { name: 'GEO/AI search optimize', luviai: true, surfer: false, jasper: false, frase: false },
  { name: 'Site sağlık taraması (audit)', luviai: '14 kontrol', surfer: 'kısmi', jasper: false, frase: false },
  { name: 'Otomatik düzeltme (sitemap, robots, llms)', luviai: true, surfer: false, jasper: false, frase: false },
  { name: 'Topic Engine (4 katman)', luviai: true, surfer: 'kısmi', jasper: false, frase: 'kısmi' },
  { name: '6-ajan kalite kontrolü', luviai: true, surfer: false, jasper: false, frase: false },
  { name: 'Marka sesi (her tenant ayrı brain)', luviai: true, surfer: false, jasper: 'manuel', frase: false },
  { name: 'PayTR (TR ödeme)', luviai: true, surfer: false, jasper: false, frase: false },
  { name: 'KVKK + TR veri merkezi', luviai: true, surfer: false, jasper: false, frase: false },
  { name: 'Aylık başlangıç fiyatı', luviai: '₺499', surfer: '$89 (~₺3.000)', jasper: '$49 (~₺1.700)', frase: '$45 (~₺1.500)' },
];

const Cell = ({ value }: { value: boolean | string }) => {
  if (value === true) return <Check className="h-5 w-5 text-green-500 mx-auto" />;
  if (value === false) return <X className="h-5 w-5 text-muted-foreground/30 mx-auto" />;
  return <span className="text-xs text-center block text-muted-foreground">{value}</span>;
};

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted">
      <header className="container flex justify-between items-center py-6">
        <Link href="/" className="text-2xl font-bold">LuviAI</Link>
        <div className="flex items-center gap-3">
          <Link href="/pricing" className="text-sm hover:text-brand">Fiyatlar</Link>
          <Link href="/faq" className="text-sm hover:text-brand">SSS</Link>
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </header>

      <main className="container max-w-5xl py-12">
        <h1 className="text-4xl md:text-5xl font-bold text-center mb-3">
          LuviAI vs Surfer vs Jasper vs Frase
        </h1>
        <p className="text-muted-foreground text-center mb-12">
          Türk pazarına özel: PayTR, KVKK, TR veri merkezi, 14 yayın hedefi.
        </p>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-4 font-semibold">Özellik</th>
                  <th className="p-4 text-center bg-brand/10">
                    <div className="font-bold text-brand">LuviAI</div>
                    <Badge className="mt-1">Türkiye</Badge>
                  </th>
                  <th className="p-4 text-center font-semibold">Surfer SEO</th>
                  <th className="p-4 text-center font-semibold">Jasper</th>
                  <th className="p-4 text-center font-semibold">Frase</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {FEATURES.map((f) => (
                  <tr key={f.name}>
                    <td className="p-4 font-medium">{f.name}</td>
                    <td className="p-4 text-center bg-brand/5"><Cell value={f.luviai} /></td>
                    <td className="p-4 text-center"><Cell value={f.surfer} /></td>
                    <td className="p-4 text-center"><Cell value={f.jasper} /></td>
                    <td className="p-4 text-center"><Cell value={f.frase} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="mt-12 grid md:grid-cols-3 gap-6">
          <Card>
            <CardContent className="p-6">
              <h3 className="font-bold mb-2">🇹🇷 Türk pazarına özel</h3>
              <p className="text-sm text-muted-foreground">
                PayTR, KVKK uyumlu, TR veri merkezi. Türkçe SEO için özelleştirilmiş 4 persona şablonu.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <h3 className="font-bold mb-2">🚀 Otopilotta yayın</h3>
              <p className="text-sm text-muted-foreground">
                14 yayın hedefi: WordPress, FTP, SFTP, Webflow, Sanity, Ghost, GitHub vb. Diğerleri sadece içerik üretir.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <h3 className="font-bold mb-2">🤖 GEO + AEO + SEO</h3>
              <p className="text-sm text-muted-foreground">
                ChatGPT/Perplexity/Claude AI alıntılanması için Auriti GEO ile optimize edilmiş içerik. Tek platform tek yerde.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-12 text-center">
          <Button asChild size="lg">
            <Link href="/onboarding">14 Gün Ücretsiz Dene →</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
