'use client';

import Link from 'next/link';
import { Check, X, Crown, Sparkles, Zap, Globe, Shield, Mic, Network, Award, FileText, BarChart3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface FeatureRow {
  name: string;
  luviai: boolean | string;
  surfer: boolean | string;
  jasper: boolean | string;
  ahrefs: boolean | string;
  frase: boolean | string;
  hint?: string;
}

interface FeatureGroup {
  title: string;
  icon: React.ReactNode;
  badge?: string;
  rows: FeatureRow[];
}

const FEATURE_GROUPS: FeatureGroup[] = [
  {
    title: 'AI İçerik Üretimi',
    icon: <Sparkles className="h-4 w-4" />,
    rows: [
      { name: 'AI ile makale üretimi', luviai: true, surfer: true, jasper: true, ahrefs: 'kısmi', frase: true },
      { name: 'Multi-LLM (Claude + GPT + Gemini + Grok + Perplexity + DeepSeek)', luviai: '6 sağlayıcı', surfer: 'sadece GPT', jasper: 'sadece GPT', ahrefs: false, frase: 'sadece GPT', hint: 'BYOK ile kendi anahtarınla sınırsız' },
      { name: '6-ajan editör pipeline (kalite kapısı)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Marka sesi (her site ayrı AI brain)', luviai: true, surfer: false, jasper: 'manuel', ahrefs: false, frase: false },
      { name: 'Türkçe optimize', luviai: 'native', surfer: 'kısmi', jasper: 'kısmi', ahrefs: 'kısmi', frase: 'kısmi' },
      { name: 'Otomatik görsel üretimi', luviai: true, surfer: false, jasper: 'add-on', ahrefs: false, frase: false },
      { name: 'Otomatik video üretimi', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'TTS / podcast / RSS', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Multi-language çeviri', luviai: 'TR + EN', surfer: false, jasper: 'add-on', ahrefs: false, frase: false },
    ],
  },
  {
    title: 'AI Search Optimization (GEO/AEO)',
    icon: <Globe className="h-4 w-4" />,
    badge: 'Türkiye\'de bir ilk',
    rows: [
      { name: 'AI Citation tracker (ChatGPT/Claude/Gemini/Perplexity)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'GEO Heatmap (rakip × AI matrix)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'GEO Score Card (6 pillar A+ → F)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'AI Mention Alarm (drop tespit + email)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'AI Crawler tracker (GPTBot, PerplexityBot vb.)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'llms.txt + llms-full.txt builder', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'AI sitemap (LLM crawler için)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Persona Chat (rakip simülasyonu)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
    ],
  },
  {
    title: 'SEO & Site Audit',
    icon: <Shield className="h-4 w-4" />,
    rows: [
      { name: 'Otomatik site audit', luviai: '14 kontrol', surfer: 'kısmi', jasper: false, ahrefs: 'detaylı', frase: 'kısmi' },
      { name: 'GSC entegrasyonu', luviai: true, surfer: false, jasper: false, ahrefs: true, frase: true },
      { name: 'GA4 entegrasyonu', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Auto-fix (sitemap, robots, schema, snippet)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Topic Engine (4 katman skoring)', luviai: true, surfer: 'kısmi', jasper: false, ahrefs: 'detaylı', frase: 'kısmi' },
      { name: 'Keyword opportunity (near-miss, gap, low-CTR)', luviai: true, surfer: 'kısmi', jasper: false, ahrefs: true, frase: 'kısmi' },
      { name: '15+ Schema tipi (FAQ, HowTo, Speakable vb.)', luviai: true, surfer: 'limited', jasper: false, ahrefs: false, frase: 'limited' },
      { name: 'PageSpeed / Core Web Vitals', luviai: true, surfer: false, jasper: false, ahrefs: 'kısmi', frase: false },
      { name: 'Cross-link önerileri', luviai: true, surfer: 'kısmi', jasper: false, ahrefs: true, frase: 'kısmi' },
      { name: 'Knowledge Graph + Wikidata', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
    ],
  },
  {
    title: 'Yayın & Dağıtım',
    icon: <Zap className="h-4 w-4" />,
    rows: [
      { name: 'Otomatik yayın hedefi', luviai: '14 platform', surfer: 'WP only', jasper: false, ahrefs: false, frase: false, hint: 'WordPress, Webflow, Ghost, Shopify, Sanity, FTP, SFTP, GitHub vb.' },
      { name: 'Sosyal medya yayını', luviai: 'IG + TikTok + LinkedIn + X', surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Onay öncesi otomatik takvim', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Tek tıkla cross-post', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
    ],
  },
  {
    title: 'Off-Page & Outreach',
    icon: <Network className="h-4 w-4" />,
    rows: [
      { name: 'HARO entegrasyonu (gazeteci sorguları)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false, hint: 'Türkiye\'de bu özelliği sunan tek platform' },
      { name: 'Community outreach (Reddit, Quora draft)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Knowledge submitter (Wikipedia, Wikidata)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Author E-E-A-T profili', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
    ],
  },
  {
    title: 'Reklam & ROAS (Bonus)',
    icon: <BarChart3 className="h-4 w-4" />,
    badge: 'Hiçbir SEO platformunda yok',
    rows: [
      { name: 'Google Ads OAuth + kampanya wizard', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Meta Ads OAuth + audience builder', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'AI ad copy + creative üretimi', luviai: true, surfer: false, jasper: 'kısmi', ahrefs: false, frase: false },
      { name: '6-saatlik ROAS auto-optimize', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
    ],
  },
  {
    title: 'Türkiye Avantajları',
    icon: <Crown className="h-4 w-4" />,
    rows: [
      { name: 'Tam Türkçe arayüz + destek', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'PayTR (TL kart, havale, kripto)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'KVKK uyumlu + TR veri merkezi', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'TL fatura (e-fatura/e-arşiv)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Whitelabel (ajanslar için)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
    ],
  },
  {
    title: 'Fiyat',
    icon: <Award className="h-4 w-4" />,
    rows: [
      { name: 'Aylık başlangıç', luviai: '₺499', surfer: '$89 (~₺3.500)', jasper: '$49 (~₺1.900)', ahrefs: '$129 (~₺5.000)', frase: '$45 (~₺1.750)' },
      { name: 'Yıllık ödeme indirimi', luviai: '%20', surfer: '%30', jasper: '%20', ahrefs: '%20', frase: '%10' },
      { name: 'Ücretsiz ilk makale', luviai: true, surfer: false, jasper: '5 gün trial', ahrefs: false, frase: '5 trial' },
      { name: 'Aylık iptal — taahhüt yok', luviai: true, surfer: true, jasper: true, ahrefs: false, frase: true },
    ],
  },
];

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <Check className="h-4 w-4 text-emerald-500 mx-auto" aria-label="Var" />;
  if (value === false) return <X className="h-4 w-4 text-muted-foreground/30 mx-auto" aria-label="Yok" />;
  return <span className="text-xs text-center block text-foreground/80 font-medium">{value}</span>;
}

function LuviCell({ value }: { value: boolean | string }) {
  if (value === true) return <Check className="h-4 w-4 text-emerald-500 mx-auto" aria-label="Var" />;
  if (value === false) return <X className="h-4 w-4 text-muted-foreground/30 mx-auto" aria-label="Yok" />;
  return <span className="text-xs text-center block text-brand font-bold">{value}</span>;
}

export default function ComparePage() {
  // Quick wins for SEO/AEO: total feature count
  const luviaiCount = FEATURE_GROUPS.flatMap(g => g.rows).filter(r => r.luviai === true || (typeof r.luviai === 'string' && r.luviai !== '')).length;

  return (
    <div className="bg-gradient-to-b from-background via-background to-muted/40">
      {/* JSON-LD: ComparisonTable + FAQ */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: 'LuviAI vs Surfer vs Jasper vs Ahrefs vs Frase Karşılaştırma',
          description: 'Türk pazarındaki AI SEO platformlarının detaylı feature karşılaştırması — AI içerik, GEO/AEO, audit, yayın, reklam.',
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: FEATURE_GROUPS.flatMap(g => g.rows).length,
            itemListElement: FEATURE_GROUPS.flatMap((g, gi) =>
              g.rows.map((r, ri) => ({
                '@type': 'ListItem',
                position: gi * 100 + ri + 1,
                name: r.name,
              }))
            ),
          },
        }) }}
      />

      <main className="container max-w-6xl py-10 sm:py-16 px-4">
        {/* HERO */}
        <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-14">
          <Badge variant="outline" className="mb-4">Detaylı feature karşılaştırma</Badge>
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-4">
            LuviAI vs<br className="sm:hidden" />{' '}
            <span className="text-brand">tüm rakipleri</span>
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground mb-6">
            <strong className="text-foreground">{luviaiCount}+ özellik</strong> tek panelde. SEO + AI Search + Reklam + Sosyal yayın
            — diğerleri tek bir alanda iyi, LuviAI hepsini birleştiren tek Türk platform.
          </p>
          <div className="flex flex-wrap justify-center gap-2 text-xs">
            <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">✓ Türkçe destek</Badge>
            <Badge className="bg-brand/10 text-brand border-brand/30">✓ KVKK + TR veri</Badge>
            <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/30">✓ PayTR ödeme</Badge>
            <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/30">✓ 14 yayın hedefi</Badge>
          </div>
        </div>

        {/* HIGHLIGHT CARDS - Why LuviAI */}
        <div className="grid sm:grid-cols-3 gap-4 mb-12">
          <Card className="border-brand/20 bg-brand/5">
            <CardContent className="p-5">
              <div className="text-2xl font-bold text-brand mb-1">6-1</div>
              <div className="text-sm font-semibold mb-1">Multi-LLM avantajı</div>
              <p className="text-xs text-muted-foreground">
                Claude, GPT, Gemini, Grok, Perplexity, DeepSeek — 6 sağlayıcı.
                Rakipler sadece OpenAI'ya bağımlı.
              </p>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/20 bg-emerald-500/5">
            <CardContent className="p-5">
              <div className="text-2xl font-bold text-emerald-600 mb-1">8</div>
              <div className="text-sm font-semibold mb-1">GEO/AEO özelliği</div>
              <p className="text-xs text-muted-foreground">
                AI citation, heatmap, score card, mention alarm, llms.txt, persona chat — rakiplerde 0.
              </p>
            </CardContent>
          </Card>
          <Card className="border-orange-500/20 bg-orange-500/5">
            <CardContent className="p-5">
              <div className="text-2xl font-bold text-orange-600 mb-1">SEO + Ads</div>
              <div className="text-sm font-semibold mb-1">Tek panelde</div>
              <p className="text-xs text-muted-foreground">
                Google Ads + Meta Ads + ROAS auto-optimize.
                SEO platformlarının hiçbirinde yok.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* COMPARISON TABLE — grouped */}
        <div className="space-y-6">
          {FEATURE_GROUPS.map((group) => (
            <Card key={group.title} className="overflow-hidden">
              <div className="bg-gradient-to-r from-muted/60 to-muted/20 px-5 py-3 border-b flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-semibold flex items-center gap-2 text-base">
                  <span className="text-brand">{group.icon}</span>
                  {group.title}
                </h2>
                {group.badge && (
                  <Badge className="bg-brand/10 text-brand border-brand/30 text-xs">{group.badge}</Badge>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold w-[40%]">Özellik</th>
                      <th className="px-2 py-2.5 text-center bg-brand/5 font-bold text-brand min-w-[80px]">LuviAI</th>
                      <th className="px-2 py-2.5 text-center font-medium min-w-[80px]">Surfer</th>
                      <th className="px-2 py-2.5 text-center font-medium min-w-[80px]">Jasper</th>
                      <th className="px-2 py-2.5 text-center font-medium min-w-[80px]">Ahrefs</th>
                      <th className="px-2 py-2.5 text-center font-medium min-w-[80px]">Frase</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {group.rows.map((f) => (
                      <tr key={f.name} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          {f.name}
                          {f.hint && (
                            <div className="text-xs text-muted-foreground mt-0.5 font-normal">{f.hint}</div>
                          )}
                        </td>
                        <td className="px-2 py-3 text-center bg-brand/5"><LuviCell value={f.luviai} /></td>
                        <td className="px-2 py-3 text-center"><Cell value={f.surfer} /></td>
                        <td className="px-2 py-3 text-center"><Cell value={f.jasper} /></td>
                        <td className="px-2 py-3 text-center"><Cell value={f.ahrefs} /></td>
                        <td className="px-2 py-3 text-center"><Cell value={f.frase} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>

        {/* SUMMARY / BOTTOM CTA */}
        <div className="mt-14 grid md:grid-cols-2 gap-6">
          <Card className="bg-gradient-to-br from-brand/5 to-transparent border-brand/20">
            <CardContent className="p-6">
              <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
                <Crown className="h-5 w-5 text-brand" />
                LuviAI'nin tek başına kapsadığı 4 dikey
              </h3>
              <ul className="text-sm space-y-2 text-muted-foreground">
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> SEO içerik üretimi (Surfer/Jasper'a alternatif)</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> AI Search Optimization (Türkiye'de ilk)</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> Reklam otopilot (Google + Meta + ROAS)</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> Sosyal medya yayın (IG + TikTok + LinkedIn + X)</li>
              </ul>
              <p className="text-xs mt-4 text-muted-foreground/80">
                Aynı işi rakip kombinasyonuyla almak: Surfer ($89) + Jasper ($49) + Ahrefs ($129) + Hootsuite ($99) = <strong className="text-foreground">$366/ay</strong>. LuviAI: <strong className="text-brand">₺499/ay</strong>.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-emerald-500/5 to-transparent border-emerald-500/20">
            <CardContent className="p-6">
              <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-600" />
                LuviAI'ye geçişte kazandıkların
              </h3>
              <ul className="text-sm space-y-2 text-muted-foreground">
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> Tek subscription, tek dashboard</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> Türkçe destek + KVKK + TL fatura</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> AI Search'te görünürlük (rakipler ortalama 6-12 ay geri)</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> BYOK ile kendi LLM anahtarın → maliyet kontrolü</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> Whitelabel — ajanslar kendi markası altında satabilir</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* FINAL CTA */}
        <div className="mt-12 text-center">
          <h3 className="text-2xl sm:text-3xl font-bold mb-3">
            14 günde 1 sayfa yerine 14 makale yayınla
          </h3>
          <p className="text-muted-foreground mb-6 max-w-xl mx-auto text-sm">
            İlk makale ücretsiz. Saatler süren işi dakikalara indir. AI Search'te de görün — 6 ay sonra gelen değişimi şimdi yakala.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-brand hover:bg-brand/90">
              <Link href="/onboarding">İlk makaleni ücretsiz al →</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">Fiyatlandırmayı incele</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
