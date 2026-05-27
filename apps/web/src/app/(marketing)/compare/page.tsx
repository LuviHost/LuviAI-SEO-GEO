'use client';

import Link from 'next/link';
import { Check, X, Crown, Sparkles, Zap, Globe, Shield, Mic, Network, Award, FileText, BarChart3, ArrowRight } from 'lucide-react';
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

      <main className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-mesh-warm opacity-70 pointer-events-none" />
        <div className="absolute inset-0 -z-10 bg-noise opacity-[0.03] pointer-events-none" />

        <div className="container-apple section-padding stagger-reveal">
          {/* HERO */}
          <div className="text-center max-w-[760px] mx-auto mb-16">
            <p className="eyebrow mb-4">Karşılaştırma</p>
            <h1 className="text-balance font-medium tracking-display text-neutral-900 dark:text-white text-[clamp(2.5rem,6vw,5rem)] leading-[0.96]">
              LuviAI{' '}
              <span className="font-display italic text-[1.08em] text-brand-600 dark:text-brand-400">vs</span>{' '}
              tüm rakipleri.
            </h1>
            <p className="text-pretty mt-7 max-w-[640px] mx-auto text-[clamp(1rem,1.4vw,1.25rem)] leading-[1.5] text-neutral-600 dark:text-neutral-400">
              <strong className="text-foreground font-medium">{luviaiCount}+ özellik</strong> tek panelde.
              SEO + AI Search + Reklam + Sosyal yayın — diğerleri tek bir alanda iyi, LuviAI hepsini birleştiren tek Türk platform.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-neutral-500 dark:text-neutral-400">
              <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-brand-500" /> Türkçe destek</span>
              <span className="text-neutral-300 dark:text-neutral-700">·</span>
              <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-brand-500" /> KVKK + TR veri</span>
              <span className="text-neutral-300 dark:text-neutral-700">·</span>
              <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-brand-500" /> PayTR ödeme</span>
              <span className="text-neutral-300 dark:text-neutral-700">·</span>
              <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-brand-500" /> 14 yayın hedefi</span>
            </div>
          </div>

        {/* HIGHLIGHT CARDS - Apple-grade */}
        <div className="grid sm:grid-cols-3 gap-4 lg:gap-6 mb-16">
          <div className="card-apple p-7">
            <div className="font-medium tracking-display text-[clamp(2.5rem,4vw,3.5rem)] leading-none bg-gradient-to-br from-brand-500 via-rose-500 to-amber-500 bg-clip-text text-transparent mb-3">6-1</div>
            <div className="text-h6 font-medium mb-2 tracking-[-0.015em]">Multi-LLM avantajı</div>
            <p className="text-[13px] text-neutral-500 dark:text-neutral-400 leading-[1.5]">
              Claude, GPT, Gemini, Grok, Perplexity, DeepSeek — 6 sağlayıcı. Rakipler sadece OpenAI'ya bağımlı.
            </p>
          </div>
          <div className="card-apple p-7">
            <div className="font-medium tracking-display text-[clamp(2.5rem,4vw,3.5rem)] leading-none text-emerald-600 dark:text-emerald-400 mb-3">8</div>
            <div className="text-h6 font-medium mb-2 tracking-[-0.015em]">GEO / AEO özelliği</div>
            <p className="text-[13px] text-neutral-500 dark:text-neutral-400 leading-[1.5]">
              AI citation, heatmap, score card, mention alarm, llms.txt, persona chat — rakiplerde 0.
            </p>
          </div>
          <div className="card-apple p-7">
            <div className="font-display italic text-[clamp(2.5rem,4vw,3.5rem)] leading-none text-foreground mb-3">tek</div>
            <div className="text-h6 font-medium mb-2 tracking-[-0.015em]">SEO + Ads panelde</div>
            <p className="text-[13px] text-neutral-500 dark:text-neutral-400 leading-[1.5]">
              Google Ads + Meta Ads + ROAS auto-optimize. SEO platformlarının hiçbirinde yok.
            </p>
          </div>
        </div>

        {/* COMPARISON TABLES — Apple-grade */}
        <div className="space-y-6">
          {FEATURE_GROUPS.map((group) => (
            <div key={group.title} className="rounded-apple border border-border/60 bg-card shadow-apple-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-border/60 flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-medium flex items-center gap-2.5 text-[15px] tracking-[-0.01em]">
                  <span className="text-brand-600 dark:text-brand-400">{group.icon}</span>
                  {group.title}
                </h2>
                {group.badge && (
                  <span className="inline-flex items-center px-2.5 h-6 rounded-full text-[10px] font-medium tracking-[0.04em] uppercase bg-brand-500/10 text-brand-700 dark:text-brand-400 border border-brand-500/20">
                    {group.badge}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead className="bg-neutral-50 dark:bg-neutral-950/40">
                    <tr>
                      <th className="text-left px-5 py-3 text-[11px] font-medium tracking-[0.06em] uppercase text-neutral-500 dark:text-neutral-400 w-[40%]">Özellik</th>
                      <th className="px-3 py-3 text-center text-[11px] font-medium tracking-[0.06em] uppercase bg-brand-500/[0.06] text-brand-700 dark:text-brand-400 min-w-[90px]">LuviAI</th>
                      <th className="px-3 py-3 text-center text-[11px] font-medium tracking-[0.06em] uppercase text-neutral-500 dark:text-neutral-400 min-w-[90px]">Surfer</th>
                      <th className="px-3 py-3 text-center text-[11px] font-medium tracking-[0.06em] uppercase text-neutral-500 dark:text-neutral-400 min-w-[90px]">Jasper</th>
                      <th className="px-3 py-3 text-center text-[11px] font-medium tracking-[0.06em] uppercase text-neutral-500 dark:text-neutral-400 min-w-[90px]">Ahrefs</th>
                      <th className="px-3 py-3 text-center text-[11px] font-medium tracking-[0.06em] uppercase text-neutral-500 dark:text-neutral-400 min-w-[90px]">Frase</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {group.rows.map((f) => (
                      <tr key={f.name} className="hover:bg-neutral-50 dark:hover:bg-neutral-950/30 transition-colors duration-300 ease-apple">
                        <td className="px-5 py-3.5">
                          <div className="font-medium text-[14px]">{f.name}</div>
                          {f.hint && (
                            <div className="text-[12px] text-neutral-500 dark:text-neutral-400 mt-1">{f.hint}</div>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-center bg-brand-500/[0.04]"><LuviCell value={f.luviai} /></td>
                        <td className="px-3 py-3.5 text-center"><Cell value={f.surfer} /></td>
                        <td className="px-3 py-3.5 text-center"><Cell value={f.jasper} /></td>
                        <td className="px-3 py-3.5 text-center"><Cell value={f.ahrefs} /></td>
                        <td className="px-3 py-3.5 text-center"><Cell value={f.frase} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* SUMMARY / BOTTOM CTA */}
        <div className="mt-20 grid md:grid-cols-2 gap-4 lg:gap-6">
          <div className="card-apple p-8 lg:p-9">
            <h3 className="font-medium text-h5 tracking-[-0.02em] mb-5 flex items-center gap-2.5">
              <Crown className="h-5 w-5 text-brand-500" strokeWidth={1.5} />
              LuviAI'nin tek başına kapsadığı 4 dikey
            </h3>
            <ul className="text-[14px] space-y-3 text-neutral-600 dark:text-neutral-400">
              <li className="flex gap-2.5"><Check className="h-3.5 w-3.5 text-brand-500 shrink-0 mt-1" strokeWidth={2.5} /> SEO içerik üretimi (Surfer/Jasper'a alternatif)</li>
              <li className="flex gap-2.5"><Check className="h-3.5 w-3.5 text-brand-500 shrink-0 mt-1" strokeWidth={2.5} /> AI Search Optimization (Türkiye'de ilk)</li>
              <li className="flex gap-2.5"><Check className="h-3.5 w-3.5 text-brand-500 shrink-0 mt-1" strokeWidth={2.5} /> Reklam otopilot (Google + Meta + ROAS)</li>
              <li className="flex gap-2.5"><Check className="h-3.5 w-3.5 text-brand-500 shrink-0 mt-1" strokeWidth={2.5} /> Sosyal medya yayın (IG + TikTok + LinkedIn + X)</li>
            </ul>
            <p className="text-[12px] mt-6 text-neutral-500 dark:text-neutral-400 leading-[1.55]">
              Aynı işi rakip kombinasyonuyla almak: Surfer ($89) + Jasper ($49) + Ahrefs ($129) + Hootsuite ($99) = <strong className="text-foreground font-medium">$366/ay</strong>. LuviAI: <strong className="text-brand-600 dark:text-brand-400 font-medium">₺499/ay</strong>.
            </p>
          </div>

          <div className="card-apple p-8 lg:p-9">
            <h3 className="font-medium text-h5 tracking-[-0.02em] mb-5 flex items-center gap-2.5">
              <Sparkles className="h-5 w-5 text-emerald-500" strokeWidth={1.5} />
              LuviAI'ye geçişte kazandıkların
            </h3>
            <ul className="text-[14px] space-y-3 text-neutral-600 dark:text-neutral-400">
              <li className="flex gap-2.5"><Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-1" strokeWidth={2.5} /> Tek subscription, tek dashboard</li>
              <li className="flex gap-2.5"><Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-1" strokeWidth={2.5} /> Türkçe destek + KVKK + TL fatura</li>
              <li className="flex gap-2.5"><Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-1" strokeWidth={2.5} /> AI Search'te görünürlük (rakipler ortalama 6-12 ay geri)</li>
              <li className="flex gap-2.5"><Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-1" strokeWidth={2.5} /> BYOK ile kendi LLM anahtarın → maliyet kontrolü</li>
              <li className="flex gap-2.5"><Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-1" strokeWidth={2.5} /> Whitelabel — ajanslar kendi markası altında satabilir</li>
            </ul>
          </div>
        </div>

        {/* FINAL CTA */}
        <div className="mt-20 text-center">
          <h3 className="text-balance font-medium tracking-display text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.05] mb-5">
            14 günde 1 sayfa yerine{' '}
            <span className="font-display italic text-[1.08em] text-brand-600 dark:text-brand-400">14 makale yayınla.</span>
          </h3>
          <p className="text-neutral-500 dark:text-neutral-400 mb-8 max-w-[560px] mx-auto text-[15px] leading-[1.55]">
            İlk makale ücretsiz. Saatler süren işi dakikalara indir. AI Search'te de görün — 6 ay sonra gelen değişimi şimdi yakala.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <Link href="/onboarding" className="btn-apple-primary group">
              İlk makaleni ücretsiz al
              <ArrowRight className="h-4 w-4 transition-transform duration-300 ease-apple group-hover:translate-x-0.5" />
            </Link>
            <Link href="/pricing" className="btn-apple-ghost">
              Fiyatlandırmayı incele
            </Link>
          </div>
        </div>
        </div>
      </main>
    </div>
  );
}
