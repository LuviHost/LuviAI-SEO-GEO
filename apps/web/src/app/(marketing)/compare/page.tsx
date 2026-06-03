'use client';

import Link from 'next/link';
import { Check, X, Crown, Sparkles, Zap, Globe, Shield, Network, Award, BarChart3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useT } from '@/lib/i18n';

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

const FEATURE_GROUPS_TR: FeatureGroup[] = [
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
      { name: 'Aylık başlangıç', luviai: '₺1.499 ($37)', surfer: '$89 (~₺3.500)', jasper: '$49 (~₺1.900)', ahrefs: '$129 (~₺5.000)', frase: '$45 (~₺1.750)' },
      { name: 'Yıllık ödeme indirimi', luviai: '%17', surfer: '%30', jasper: '%20', ahrefs: '%20', frase: '%10' },
      { name: '2 ücretsiz makale', luviai: true, surfer: false, jasper: '5 gün trial', ahrefs: false, frase: '5 trial' },
      { name: 'Aylık iptal — taahhüt yok', luviai: true, surfer: true, jasper: true, ahrefs: false, frase: true },
    ],
  },
];

const FEATURE_GROUPS_EN: FeatureGroup[] = [
  {
    title: 'AI Content Generation',
    icon: <Sparkles className="h-4 w-4" />,
    rows: [
      { name: 'AI article generation', luviai: true, surfer: true, jasper: true, ahrefs: 'partial', frase: true },
      { name: 'Multi-LLM (Claude + GPT + Gemini + Grok + Perplexity + DeepSeek)', luviai: '6 providers', surfer: 'GPT only', jasper: 'GPT only', ahrefs: false, frase: 'GPT only', hint: 'Unlimited with BYOK key' },
      { name: '6-agent editor pipeline (quality gate)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Brand voice (separate AI brain per site)', luviai: true, surfer: false, jasper: 'manual', ahrefs: false, frase: false },
      { name: 'Turkish optimized', luviai: 'native', surfer: 'partial', jasper: 'partial', ahrefs: 'partial', frase: 'partial' },
      { name: 'Auto image generation', luviai: true, surfer: false, jasper: 'add-on', ahrefs: false, frase: false },
      { name: 'Auto video generation', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'TTS / podcast / RSS', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Multi-language translation', luviai: 'TR + EN', surfer: false, jasper: 'add-on', ahrefs: false, frase: false },
    ],
  },
  {
    title: 'AI Search Optimization (GEO/AEO)',
    icon: <Globe className="h-4 w-4" />,
    badge: 'First in Turkey',
    rows: [
      { name: 'AI Citation tracker (ChatGPT/Claude/Gemini/Perplexity)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'GEO Heatmap (competitor × AI matrix)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'GEO Score Card (6 pillar A+ → F)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'AI Mention Alarm (drop detection + email)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'AI Crawler tracker (GPTBot, PerplexityBot etc.)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'llms.txt + llms-full.txt builder', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'AI sitemap (for LLM crawlers)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Persona Chat (competitor simulation)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
    ],
  },
  {
    title: 'SEO & Site Audit',
    icon: <Shield className="h-4 w-4" />,
    rows: [
      { name: 'Automatic site audit', luviai: '14 checks', surfer: 'partial', jasper: false, ahrefs: 'detailed', frase: 'partial' },
      { name: 'GSC integration', luviai: true, surfer: false, jasper: false, ahrefs: true, frase: true },
      { name: 'GA4 integration', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Auto-fix (sitemap, robots, schema, snippet)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Topic Engine (4-layer scoring)', luviai: true, surfer: 'partial', jasper: false, ahrefs: 'detailed', frase: 'partial' },
      { name: 'Keyword opportunity (near-miss, gap, low-CTR)', luviai: true, surfer: 'partial', jasper: false, ahrefs: true, frase: 'partial' },
      { name: '15+ schema types (FAQ, HowTo, Speakable etc.)', luviai: true, surfer: 'limited', jasper: false, ahrefs: false, frase: 'limited' },
      { name: 'PageSpeed / Core Web Vitals', luviai: true, surfer: false, jasper: false, ahrefs: 'partial', frase: false },
      { name: 'Cross-link suggestions', luviai: true, surfer: 'partial', jasper: false, ahrefs: true, frase: 'partial' },
      { name: 'Knowledge Graph + Wikidata', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
    ],
  },
  {
    title: 'Publishing & Distribution',
    icon: <Zap className="h-4 w-4" />,
    rows: [
      { name: 'Auto publish targets', luviai: '14 platforms', surfer: 'WP only', jasper: false, ahrefs: false, frase: false, hint: 'WordPress, Webflow, Ghost, Shopify, Sanity, FTP, SFTP, GitHub etc.' },
      { name: 'Social media publishing', luviai: 'IG + TikTok + LinkedIn + X', surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Auto scheduling before approval', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'One-click cross-post', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
    ],
  },
  {
    title: 'Off-Page & Outreach',
    icon: <Network className="h-4 w-4" />,
    rows: [
      { name: 'HARO integration (journalist queries)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false, hint: 'Only Turkish-supporting platform offering this' },
      { name: 'Community outreach (Reddit, Quora draft)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Knowledge submitter (Wikipedia, Wikidata)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Author E-E-A-T profile', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
    ],
  },
  {
    title: 'Ads & ROAS (Bonus)',
    icon: <BarChart3 className="h-4 w-4" />,
    badge: 'Not in any other SEO platform',
    rows: [
      { name: 'Google Ads OAuth + campaign wizard', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Meta Ads OAuth + audience builder', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'AI ad copy + creative generation', luviai: true, surfer: false, jasper: 'partial', ahrefs: false, frase: false },
      { name: '6-hour ROAS auto-optimize', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
    ],
  },
  {
    title: 'Turkey Advantages',
    icon: <Crown className="h-4 w-4" />,
    rows: [
      { name: 'Full Turkish UI + support', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'PayTR (TRY card, transfer, crypto)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'KVKK-compliant + TR data center', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'TRY invoice (e-invoice/e-archive)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'White-label (for agencies)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
    ],
  },
  {
    title: 'Price',
    icon: <Award className="h-4 w-4" />,
    rows: [
      { name: 'Monthly starting', luviai: '₺1,499 ($37)', surfer: '$89 (~₺3,500)', jasper: '$49 (~₺1,900)', ahrefs: '$129 (~₺5,000)', frase: '$45 (~₺1,750)' },
      { name: 'Yearly discount', luviai: '17%', surfer: '30%', jasper: '20%', ahrefs: '20%', frase: '10%' },
      { name: '2 free articles', luviai: true, surfer: false, jasper: '5-day trial', ahrefs: false, frase: '5 trial' },
      { name: 'Monthly cancel — no commitment', luviai: true, surfer: true, jasper: true, ahrefs: false, frase: true },
    ],
  },
];

const COPY = {
  tr: {
    eyebrow: '⚖️ Detaylı karşılaştırma',
    titleA: 'RanksUp vs',
    titleB: 'tüm rakipleri',
    leadA: '+ özellik',
    lead: ' tek panelde. SEO + AI Search + Reklam + Sosyal yayın — diğerleri tek bir alanda iyi, RanksUp hepsini birleştiren tek Türk platform.',
    badge1: '✓ Türkçe destek',
    badge2: '✓ KVKK + TR veri',
    badge3: '✓ PayTR ödeme',
    badge4: '✓ 14 yayın hedefi',
    hc1Title: 'Multi-LLM avantajı',
    hc1Desc: 'Claude, GPT, Gemini, Grok, Perplexity, DeepSeek — 6 sağlayıcı. Rakipler sadece OpenAI\'ya bağımlı.',
    hc2Num: '8',
    hc2Title: 'GEO/AEO özelliği',
    hc2Desc: 'AI citation, heatmap, score card, mention alarm, llms.txt, persona chat — rakiplerde 0.',
    hc3Num: 'SEO + Ads',
    hc3Title: 'Tek panelde',
    hc3Desc: 'Google Ads + Meta Ads + ROAS auto-optimize. SEO platformlarının hiçbirinde yok.',
    tableHeaderFeature: 'Özellik',
    sumLeftTitle: 'RanksUp\'nin tek başına kapsadığı 4 dikey',
    sumLeftItems: [
      'SEO içerik üretimi (Surfer/Jasper\'a alternatif)',
      'AI Search Optimization (Türkiye\'de ilk)',
      'Reklam otopilot (Google + Meta + ROAS)',
      'Sosyal medya yayın (IG + TikTok + LinkedIn + X)',
    ],
    sumLeftNote: 'Aynı işi rakip kombinasyonuyla almak: Surfer ($89) + Jasper ($49) + Ahrefs ($129) + Hootsuite ($99) = ',
    sumLeftNotePrice: '$366/ay (≈ ₺14.640)',
    sumLeftNote2: '. RanksUp Başlangıç: ',
    sumLeftLuviStart: '₺1.499/ay ($37)',
    sumLeftNote3: ', Profesyonel: ',
    sumLeftLuviPro: '₺4.999/ay ($125)',
    sumLeftNoteEnd: '.',
    sumRightTitle: 'RanksUp\'ye geçişte kazandıkların',
    sumRightItems: [
      'Tek subscription, tek dashboard',
      'Türkçe destek + KVKK + TL fatura',
      'AI Search\'te görünürlük (rakipler ortalama 6-12 ay geri)',
      'BYOK ile kendi LLM anahtarın → maliyet kontrolü',
      'Whitelabel — ajanslar kendi markası altında satabilir',
    ],
    ctaTitle: 'Saatler süren işi dakikaya indir',
    ctaSub: 'İlk 2 makale ücretsiz, kart gerekmez. SEO + AI Search\'te bir arada görün — 6 ay sonra gelen değişimi şimdi yakala.',
    ctaPrimary: 'İlk makaleni ücretsiz al →',
    ctaSecondary: 'Fiyatlandırmayı incele',
  },
  en: {
    eyebrow: '⚖️ Detailed comparison',
    titleA: 'RanksUp vs',
    titleB: 'every competitor',
    leadA: '+ features',
    lead: ' in one dashboard. SEO + AI Search + Ads + Social publishing — others excel in one area, RanksUp is the only Turkey-built platform combining all.',
    badge1: '✓ Turkish support',
    badge2: '✓ KVKK + TR data',
    badge3: '✓ PayTR payment',
    badge4: '✓ 14 publish targets',
    hc1Title: 'Multi-LLM advantage',
    hc1Desc: 'Claude, GPT, Gemini, Grok, Perplexity, DeepSeek — 6 providers. Competitors lock you to OpenAI.',
    hc2Num: '8',
    hc2Title: 'GEO/AEO features',
    hc2Desc: 'AI citation, heatmap, score card, mention alarm, llms.txt, persona chat — 0 in competitors.',
    hc3Num: 'SEO + Ads',
    hc3Title: 'In one panel',
    hc3Desc: 'Google Ads + Meta Ads + ROAS auto-optimize. Not in any SEO platform.',
    tableHeaderFeature: 'Feature',
    sumLeftTitle: '4 verticals only RanksUp covers alone',
    sumLeftItems: [
      'SEO content generation (Surfer/Jasper alternative)',
      'AI Search Optimization (first in Turkey)',
      'Ad autopilot (Google + Meta + ROAS)',
      'Social media publishing (IG + TikTok + LinkedIn + X)',
    ],
    sumLeftNote: 'Same job via competitors: Surfer ($89) + Jasper ($49) + Ahrefs ($129) + Hootsuite ($99) = ',
    sumLeftNotePrice: '$366/mo (≈ ₺14,640)',
    sumLeftNote2: '. RanksUp Starter: ',
    sumLeftLuviStart: '₺1,499/mo ($37)',
    sumLeftNote3: ', Professional: ',
    sumLeftLuviPro: '₺4,999/mo ($125)',
    sumLeftNoteEnd: '.',
    sumRightTitle: 'What you gain by switching to RanksUp',
    sumRightItems: [
      'One subscription, one dashboard',
      'Turkish support + KVKK + TRY invoice',
      'Visibility in AI Search (competitors avg 6-12 months behind)',
      'BYOK with your own LLM key → cost control',
      'White-label — agencies can resell under their brand',
    ],
    ctaTitle: 'Cut hours-long work to minutes',
    ctaSub: 'First 2 articles free, no card. Be visible in both SEO + AI Search — catch the shift coming in 6 months, now.',
    ctaPrimary: 'Get your first article free →',
    ctaSecondary: 'See pricing',
  },
} as const;

function makeCell(yesLabel: string, noLabel: string) {
  return function Cell({ value }: { value: boolean | string }) {
    if (value === true) return <Check className="h-4 w-4 text-emerald-500 mx-auto" aria-label={yesLabel} />;
    if (value === false) return <X className="h-4 w-4 text-muted-foreground/30 mx-auto" aria-label={noLabel} />;
    return <span className="text-xs text-center block text-foreground/80 font-medium">{value}</span>;
  };
}

function makeLuviCell(yesLabel: string, noLabel: string) {
  return function LuviCell({ value }: { value: boolean | string }) {
    if (value === true) return <Check className="h-4 w-4 text-emerald-500 mx-auto" aria-label={yesLabel} />;
    if (value === false) return <X className="h-4 w-4 text-muted-foreground/30 mx-auto" aria-label={noLabel} />;
    return <span className="text-xs text-center block text-brand font-bold">{value}</span>;
  };
}

export default function ComparePage() {
  const { locale } = useT();
  const c = COPY[locale];
  const FEATURE_GROUPS = locale === 'en' ? FEATURE_GROUPS_EN : FEATURE_GROUPS_TR;
  const luviaiCount = FEATURE_GROUPS.flatMap((g) => g.rows).filter((r) => r.luviai === true || (typeof r.luviai === 'string' && r.luviai !== '')).length;
  const Cell = makeCell(locale === 'en' ? 'Yes' : 'Var', locale === 'en' ? 'No' : 'Yok');
  const LuviCell = makeLuviCell(locale === 'en' ? 'Yes' : 'Var', locale === 'en' ? 'No' : 'Yok');

  return (
    <div className="bg-gradient-to-b from-background via-background to-muted/40">
      {/* JSON-LD: ComparisonTable + FAQ */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: 'RanksUp vs Surfer vs Jasper vs Ahrefs vs Frase Comparison',
          description: 'Detailed feature comparison of AI SEO platforms — AI content, GEO/AEO, audit, publishing, ads.',
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: FEATURE_GROUPS.flatMap((g) => g.rows).length,
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

      <main className="relative">
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
          <div className="absolute top-60 -right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* HERO */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-600 text-xs font-semibold mb-5">
            {c.eyebrow}
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-4">
            {c.titleA}{' '}
            <span className="bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 bg-clip-text text-transparent">
              {c.titleB}
            </span>
          </h1>
          <p className="text-lg text-muted-foreground mb-6">
            <strong className="text-foreground">{luviaiCount}{c.leadA}</strong>{c.lead}
          </p>
          <div className="flex flex-wrap justify-center gap-2 text-xs">
            <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">{c.badge1}</Badge>
            <Badge className="bg-brand/10 text-brand border-brand/30">{c.badge2}</Badge>
            <Badge className="bg-orange-500/10 text-orange-600 border-orange-500/30">{c.badge3}</Badge>
            <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/30">{c.badge4}</Badge>
          </div>
        </div>

        {/* HIGHLIGHT CARDS - Why RanksUp */}
        <div className="grid sm:grid-cols-3 gap-4 mb-12">
          <Card className="border-brand/20 bg-brand/5">
            <CardContent className="p-5">
              <div className="text-2xl font-bold text-brand mb-1">6-1</div>
              <div className="text-sm font-semibold mb-1">{c.hc1Title}</div>
              <p className="text-xs text-muted-foreground">{c.hc1Desc}</p>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/20 bg-emerald-500/5">
            <CardContent className="p-5">
              <div className="text-2xl font-bold text-emerald-600 mb-1">{c.hc2Num}</div>
              <div className="text-sm font-semibold mb-1">{c.hc2Title}</div>
              <p className="text-xs text-muted-foreground">{c.hc2Desc}</p>
            </CardContent>
          </Card>
          <Card className="border-orange-500/20 bg-orange-500/5">
            <CardContent className="p-5">
              <div className="text-2xl font-bold text-orange-600 mb-1">{c.hc3Num}</div>
              <div className="text-sm font-semibold mb-1">{c.hc3Title}</div>
              <p className="text-xs text-muted-foreground">{c.hc3Desc}</p>
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
                      <th className="text-left px-4 py-2.5 font-semibold w-[40%]">{c.tableHeaderFeature}</th>
                      <th className="px-2 py-2.5 text-center bg-brand/5 font-bold text-brand min-w-[80px]">RanksUp</th>
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
                {c.sumLeftTitle}
              </h3>
              <ul className="text-sm space-y-2 text-muted-foreground">
                {c.sumLeftItems.map((it) => (
                  <li key={it} className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> {it}</li>
                ))}
              </ul>
              <p className="text-xs mt-4 text-muted-foreground/80">
                {c.sumLeftNote}<strong className="text-foreground">{c.sumLeftNotePrice}</strong>{c.sumLeftNote2}<strong className="text-brand">{c.sumLeftLuviStart}</strong>{c.sumLeftNote3}<strong className="text-brand">{c.sumLeftLuviPro}</strong>{c.sumLeftNoteEnd}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-emerald-500/5 to-transparent border-emerald-500/20">
            <CardContent className="p-6">
              <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-600" />
                {c.sumRightTitle}
              </h3>
              <ul className="text-sm space-y-2 text-muted-foreground">
                {c.sumRightItems.map((it) => (
                  <li key={it} className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> {it}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* FINAL CTA */}
        <div className="mt-16 rounded-2xl bg-gradient-to-br from-orange-500 via-orange-600 to-red-600 text-white p-10 text-center">
          <h3 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold mb-3">{c.ctaTitle}</h3>
          <p className="text-white/90 mb-6 max-w-xl mx-auto">{c.ctaSub}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-white text-orange-600 hover:bg-white/90 shadow-xl">
              <Link href="/onboarding">{c.ctaPrimary}</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="bg-transparent border-white/30 text-white hover:bg-white/10">
              <Link href="/pricing">{c.ctaSecondary}</Link>
            </Button>
          </div>
        </div>
        </div>
      </main>
    </div>
  );
}
