'use client';

import Link from 'next/link';
import { Check, X, Crown, Sparkles, Zap, Globe, Shield, Network, Award, BarChart3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useT, type Locale } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { PageUpdatedLine } from '@/components/page-updated-line';
import { pageUpdated, SITE_URL } from '@/lib/page-updated';
import { pickComparePrices, type ComparePlanPrice } from './compare-prices';

/**
 * Hucre degeri: true = var, false = yok, metin = ayrinti, null = bu satirda
 * rakip bilgisi DOGRULANMADI ("—" gosterilir, alt notta aciklanir).
 *
 * NEDEN null: rakip sutunlari 2026 basinda yazilmisti ve 18.10.2026'da
 * ureticilerin kendi sayfalariyla karsilastirildiginda bircok "✗" yanlis
 * cikti — Surfer (AI Search Analytics planı), Jasper (GEO Hub), Ahrefs (Brand
 * Radar) ve Frase (AI Visibility) artik AI gorunurlugunu olcuyor; Jasper tek
 * modele bagli degil; Frase WordPress/Webflow/Sanity/Wix'e yayinliyor; Surfer
 * Search Console'a baglaniyor. Dogrulanmamis bir "yok" iddiasi yayimlamak
 * yerine hucre bos birakilir. Dogrulanan hucrelerin kaynaklari:
 *   https://surferseo.com/pricing/
 *   https://docs.surferseo.com/en/articles/11394329-step-1-how-to-add-google-search-console-to-surfer
 *   https://www.jasper.ai/pricing
 *   https://help.jasper.ai/hc/en-us/articles/51579082265883-GEO-Hub
 *   https://ahrefs.com/pricing , https://ahrefs.com/brand-radar
 *   https://www.frase.io/pricing
 * Turkiye ve reklam gruplarindaki "yok"lar (PayTR, KVKK/TR veri merkezi,
 * Turkce arayuz, Google/Meta reklam hesabi yonetimi) bu araclarin urun
 * kapsaminda olmadigi icin korundu.
 *
 * GEON ve SEOYEN (24.10.2026 eklendi): YALNIZ kendi sayfalarinda o gun okunan
 * bilgiler yazildi; yazilmayan her hucre null ("—", Dogrulanmadi). Sayfada bir
 * ozelligin GECMEMESI "yok" (false) sayilmadi.
 *   https://usegeon.com/ , https://usegeon.com/fiyatlandirma
 *     6 asistan (ChatGPT, Gemini, Perplexity, Claude, Grok, DeepSeek); Turkce
 *     arayuz + Turkce destek; kayitta 5 ucretsiz kredi (5 prompt taramasi).
 *   https://seoyen.com/
 *     AI icerik + WordPress'e tek tikla yayin; AI gorunurluk ChatGPT, Gemini,
 *     Claude + Google AI Overview; site denetimi 245 otomatik kontrol; TL fiyat,
 *     iyzico; "Tum veriler Turkiye'deki sunucularda" (KVKK anilmiyor); Turkce
 *     arayuz (destek dili yazmiyor); yillik odemede %20; 7 gun deneme 50 TL.
 */
type CellValue = boolean | string | null;

interface FeatureRow {
  name: string;
  luviai: boolean | string;
  surfer: CellValue;
  jasper: CellValue;
  ahrefs: CellValue;
  frase: CellValue;
  /** Yazilmazsa null (dogrulanmadi) — bkz. ustteki GEON / SEOYEN kaynak notu */
  geon?: CellValue;
  seoyen?: CellValue;
  hint?: string;
}

interface FeatureGroup {
  id: 'content' | 'geo' | 'seo' | 'publish' | 'offpage' | 'ads' | 'turkey' | 'price';
  title: string;
  icon: React.ReactNode;
  badge?: string;
  rows: FeatureRow[];
}

const FEATURE_GROUPS_TR: FeatureGroup[] = [
  {
    id: 'content',
    title: 'AI İçerik Üretimi',
    icon: <Sparkles className="h-4 w-4" />,
    rows: [
      { name: 'AI ile makale üretimi', luviai: true, surfer: true, jasper: true, ahrefs: null, frase: true, seoyen: true },
      // Uretim hatti 5 ajan: apps/api/src/articles/pipeline.service.ts (yayin bir ajan degil)
      { name: '5 ajanlı üretim hattı + yayın öncesi kalite kapısı', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null, hint: 'Anahtar kelime → taslak → yazar → editör → görsel; kaynaksız sayı, uydurma iç bağlantı ve yapı kontrolleri yayından önce yapılır.' },
      { name: 'Marka sesi (her site için ayrı marka beyni)', luviai: true, surfer: 'Brand Knowledge', jasper: 'Brand Voice', ahrefs: null, frase: 'Brand Voice' },
      { name: 'Türkçe optimize', luviai: 'native', surfer: 'kısmi', jasper: 'kısmi', ahrefs: 'kısmi', frase: 'kısmi' },
      { name: 'Otomatik görsel üretimi', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
    ],
  },
  {
    id: 'geo',
    title: 'AI Search Optimization (GEO/AEO)',
    icon: <Globe className="h-4 w-4" />,
    rows: [
      { name: 'AI görünürlük takibi (asistan cevaplarında marka ve kaynak)', luviai: '6 asistan', surfer: 'AI Search Analytics planı', jasper: 'GEO Hub (Business)', ahrefs: 'Brand Radar', frase: 'AI Visibility', geon: '6 asistan', seoyen: 'ChatGPT, Gemini, Claude + AI Overview', hint: 'RanksUp: ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek; ölçümü sen başlatırsın, hesap başına 7 günde 1. Rakiplerde kapsam plana göre değişir; Google AI Overviews / AI Mode ve Copilot gibi motorları ölçenler var, RanksUp bunları ölçmez.' },
      { name: 'GEO ısı haritası (rakip × AI asistanı)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'GEO Skor Kartı (6 başlık, A+ → F)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'AI görünürlük düşüş alarmı (e-posta)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: 'uyarılar' },
      { name: 'AI tarayıcı takibi (GPTBot, PerplexityBot vb.)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'llms.txt + llms-full.txt üretici', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: 'FraseCMS sayfalarında' },
      { name: 'AI özetli site haritası (sitemap-ai.xml)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Persona sohbeti (rakip simülasyonu)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Kapalı döngü: kaybedilen soru → içerik → QA → yeniden ölçüm', luviai: true, surfer: null, jasper: 'GEO Agent (Business)', ahrefs: null, frase: null, hint: 'Kaybedilen sorudan makale fırsatı çıkar, makale kalite kapısından geçer, yayından sonra aynı soru yeniden ölçülür (Profesyonel ve üstü).' },
    ],
  },
  {
    id: 'seo',
    title: 'SEO & Site Audit',
    icon: <Shield className="h-4 w-4" />,
    rows: [
      { name: 'Otomatik site denetimi', luviai: '14 kontrol', surfer: null, jasper: false, ahrefs: 'Site Audit', frase: 'sayfa denetimi', seoyen: '245 kontrol' },
      { name: 'Search Console entegrasyonu', luviai: true, surfer: true, jasper: null, ahrefs: null, frase: null },
      { name: 'Organik trafik verisi: Search Console gerçeği vs. tahmin', luviai: 'GSC gerçek', surfer: null, jasper: null, ahrefs: 'tahmin', frase: null, hint: 'Üçüncü taraf araçların "organik trafik" rakamı modelleme tahminidir. RanksUp birinci taraf Search Console verisini ve markalı/markasız ayrımını kullanır.' },
      { name: 'GA4 entegrasyonu', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Kök dosya düzeltmesi (robots.txt, sitemap.xml, llms.txt) + şema/meta snippet', luviai: 'önizlemeli', surfer: null, jasper: null, ahrefs: null, frase: null, hint: 'robots.txt mevcut dosyayla birleştirilir ve farkı görüp onaylamadan yazılmaz; mevcut dosyanın önceki hali yedeklenir ve dosya o günden beri değişmediyse geri alınabilir. sitemap.xml / llms.txt yalnızca dosya yoksa oluşturulur; yeni oluşturulan dosyayı kaldırmak için sunucudan silmek gerekir.' },
      { name: 'Konu motoru (4 katman puanlama)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Anahtar kelime fırsatı (ilk sayfaya yakın, boşluk, düşük CTR)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: '15+ şema tipi (FAQ, HowTo, Speakable vb.)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'PageSpeed / Core Web Vitals', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'İç bağlantı önerileri', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: 'Professional planında' },
      { name: 'Knowledge Graph + Wikidata', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
    ],
  },
  {
    id: 'publish',
    title: 'Yayın & Dağıtım',
    icon: <Zap className="h-4 w-4" />,
    rows: [
      { name: 'Otomatik yayın hedefi', luviai: '14 hedef', surfer: null, jasper: null, ahrefs: null, frase: 'WordPress, Webflow, Sanity, Wix', seoyen: 'WordPress', hint: 'RanksUp: WordPress, Webflow, Ghost, Sanity, Contentful, Strapi, FTP, SFTP, cPanel, GitHub, WHMCS bilgi bankası, özel PHP ucu ve Markdown ZIP.' },
      { name: 'Konuları otomatik takvime yerleştirme', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Bir makaleyi birden çok yayın hedefine gönderme', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
    ],
  },
  {
    id: 'offpage',
    title: 'Off-Page & Outreach',
    icon: <Network className="h-4 w-4" />,
    rows: [
      { name: 'HARO e-posta özetinden gazeteci sorgusu + yanıt taslağı', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Topluluk ajanı (Reddit, Quora yanıt taslağı)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Wikidata / Wikipedia taslağı', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Yazar E-E-A-T profili (Person şeması)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
    ],
  },
  {
    id: 'ads',
    title: 'Reklam & ROAS',
    icon: <BarChart3 className="h-4 w-4" />,
    rows: [
      { name: 'Google Ads + Meta Ads hesap bağlantısı', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Kampanya Skoru (reklam hesabı denetimi)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: '6 saatlik ROAS otopilotu', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false, hint: 'Varsayılan kapalı. Açıkken düşük getirili kampanyayı durdurur, yüksek getirilinin bütçesini artırır, alakasız arama terimlerini negatif anahtar kelime yapar.' },
    ],
  },
  {
    id: 'turkey',
    title: 'Türkiye Avantajları',
    icon: <Crown className="h-4 w-4" />,
    rows: [
      { name: 'Tam Türkçe arayüz + destek', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false, geon: true, seoyen: 'Türkçe arayüz' },
      { name: 'PayTR ile Türk lirası ödeme', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false, seoyen: 'TL (iyzico)' },
      { name: 'KVKK uyumlu + TR veri merkezi', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false, seoyen: 'TR sunucu' },
    ],
  },
  {
    id: 'price',
    title: 'Fiyat',
    icon: <Award className="h-4 w-4" />,
    rows: [
      // Surfer SSS'si "up to 17%" diyor (surferseo.com/pricing, 18.10.2026); "~%17" degil
      { name: 'Yıllık ödeme indirimi', luviai: '%17', surfer: '%17\'ye kadar', jasper: '~%20', ahrefs: '%17\'ye kadar', frase: '%20', seoyen: '%20' },
      { name: 'Ücretsiz deneme', luviai: '2 makale, kart yok', surfer: null, jasper: '7 gün', ahrefs: 'Ahrefs Free (sınırlı)', frase: '7 gün, kart yok', geon: '5 ücretsiz kredi', seoyen: 'ücretli: 50 TL, 7 gün' },
      { name: 'Aylık plan — uzun taahhüt yok', luviai: true, surfer: true, jasper: true, ahrefs: 'Enterprise hariç', frase: true },
    ],
  },
];

const FEATURE_GROUPS_EN: FeatureGroup[] = [
  {
    id: 'content',
    title: 'AI Content Generation',
    icon: <Sparkles className="h-4 w-4" />,
    rows: [
      { name: 'AI article generation', luviai: true, surfer: true, jasper: true, ahrefs: null, frase: true, seoyen: true },
      { name: '5-agent pipeline + pre-publish quality gate', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null, hint: 'Keyword → outline → writer → editor → visuals; unsourced numbers, made-up internal links and structure are checked before publishing.' },
      { name: 'Brand voice (separate brand brain per site)', luviai: true, surfer: 'Brand Knowledge', jasper: 'Brand Voice', ahrefs: null, frase: 'Brand Voice' },
      { name: 'Turkish optimized', luviai: 'native', surfer: 'partial', jasper: 'partial', ahrefs: 'partial', frase: 'partial' },
      { name: 'Auto image generation', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
    ],
  },
  {
    id: 'geo',
    title: 'AI Search Optimization (GEO/AEO)',
    icon: <Globe className="h-4 w-4" />,
    rows: [
      { name: 'AI visibility tracking (brand and source in assistant answers)', luviai: '6 assistants', surfer: 'AI Search Analytics plan', jasper: 'GEO Hub (Business)', ahrefs: 'Brand Radar', frase: 'AI Visibility', geon: '6 assistants', seoyen: 'ChatGPT, Gemini, Claude + AI Overview', hint: 'RanksUp: ChatGPT, Claude, Gemini, Perplexity, Grok and DeepSeek; you start each measurement, once every 7 days per account. Competitor coverage depends on the plan; some track engines such as Google AI Overviews / AI Mode and Copilot, which RanksUp does not measure.' },
      { name: 'GEO heatmap (competitor × AI assistant)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'GEO Score Card (6 pillars, A+ → F)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'AI visibility drop alert (email)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: 'alerts' },
      { name: 'AI crawler tracking (GPTBot, PerplexityBot etc.)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'llms.txt + llms-full.txt builder', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: 'on FraseCMS pages' },
      { name: 'AI-summary sitemap (sitemap-ai.xml)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Persona chat (competitor simulation)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Closed loop: lost query → content → QA → re-measure', luviai: true, surfer: null, jasper: 'GEO Agent (Business)', ahrefs: null, frase: null, hint: 'A lost query becomes an article opportunity, the article passes the quality gate, and the same query is re-measured after publishing (Professional and up).' },
    ],
  },
  {
    id: 'seo',
    title: 'SEO & Site Audit',
    icon: <Shield className="h-4 w-4" />,
    rows: [
      { name: 'Automatic site audit', luviai: '14 checks', surfer: null, jasper: false, ahrefs: 'Site Audit', frase: 'page audits', seoyen: '245 checks' },
      { name: 'Search Console integration', luviai: true, surfer: true, jasper: null, ahrefs: null, frase: null },
      { name: 'Organic traffic data: Search Console truth vs. estimates', luviai: 'GSC actuals', surfer: null, jasper: null, ahrefs: 'estimate', frase: null, hint: 'Third-party "organic traffic" numbers are modelled estimates. RanksUp uses first-party Search Console data with a branded/non-branded split.' },
      { name: 'GA4 integration', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Root-file fixes (robots.txt, sitemap.xml, llms.txt) + schema/meta snippets', luviai: 'previewed', surfer: null, jasper: null, ahrefs: null, frase: null, hint: 'robots.txt is merged with your existing file and never written until you review the diff and confirm; the previous version of an existing file is backed up and can be restored if it hasn\'t changed since. sitemap.xml / llms.txt are only created when missing; to undo, delete the new file from your server.' },
      { name: 'Topic engine (4-layer scoring)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Keyword opportunities (near-miss, gap, low CTR)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: '15+ schema types (FAQ, HowTo, Speakable etc.)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'PageSpeed / Core Web Vitals', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Internal link suggestions', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: 'on Professional' },
      { name: 'Knowledge Graph + Wikidata', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
    ],
  },
  {
    id: 'publish',
    title: 'Publishing & Distribution',
    icon: <Zap className="h-4 w-4" />,
    rows: [
      { name: 'Auto publish targets', luviai: '14 targets', surfer: null, jasper: null, ahrefs: null, frase: 'WordPress, Webflow, Sanity, Wix', seoyen: 'WordPress', hint: 'RanksUp: WordPress, Webflow, Ghost, Sanity, Contentful, Strapi, FTP, SFTP, cPanel, GitHub, WHMCS knowledge base, custom PHP endpoint and Markdown ZIP.' },
      { name: 'Automatic topic scheduling', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Publish one article to several targets', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
    ],
  },
  {
    id: 'offpage',
    title: 'Off-Page & Outreach',
    icon: <Network className="h-4 w-4" />,
    rows: [
      { name: 'Journalist queries from HARO email digests + reply drafts', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Community agent (Reddit, Quora reply drafts)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Wikidata / Wikipedia drafts', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
      { name: 'Author E-E-A-T profile (Person schema)', luviai: true, surfer: null, jasper: null, ahrefs: null, frase: null },
    ],
  },
  {
    id: 'ads',
    title: 'Ads & ROAS',
    icon: <BarChart3 className="h-4 w-4" />,
    rows: [
      { name: 'Google Ads + Meta Ads account connection', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: 'Campaign Score (ad account audit)', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false },
      { name: '6-hour ROAS autopilot', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false, hint: 'Off by default. When on, it pauses low-return campaigns, raises the budget of high-return ones and adds irrelevant search terms as negative keywords.' },
    ],
  },
  {
    id: 'turkey',
    title: 'Turkey Advantages',
    icon: <Crown className="h-4 w-4" />,
    rows: [
      { name: 'Full Turkish UI + support', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false, geon: true, seoyen: 'Turkish UI' },
      { name: 'Turkish lira payments via PayTR', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false, seoyen: 'TRY (iyzico)' },
      { name: 'KVKK-compliant + TR data center', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false, seoyen: 'TR servers' },
    ],
  },
  {
    id: 'price',
    title: 'Price',
    icon: <Award className="h-4 w-4" />,
    rows: [
      { name: 'Yearly discount', luviai: '17%', surfer: 'up to 17%', jasper: '~20%', ahrefs: 'up to 17%', frase: '20%', seoyen: '20%' },
      { name: 'Free trial', luviai: '2 articles, no card', surfer: null, jasper: '7 days', ahrefs: 'Ahrefs Free (limited)', frase: '7 days, no card', geon: '5 free credits', seoyen: 'paid: TRY 50, 7 days' },
      { name: 'Monthly plan — no long commitment', luviai: true, surfer: true, jasper: true, ahrefs: 'except Enterprise', frase: true },
    ],
  },
];

/**
 * Semrush 6-aylik AI arama playbook'u (22 adim) — RanksUp'taki karsiligi.
 * Durumlar kod dogrulamasina dayanir (27.08.2026): auto = urun kendiliginden
 * yapar, partial = kismen/elle tetikli, none = henuz yok. Rakibin kendi
 * rehberi bizim kapali dongumuzun en iyi satis dokumani.
 *
 * 18.10.2026 guncellemesi (kodla yeniden dogrulandi):
 *  - 1-2: Llama olculmuyor (Groq modeli kaldirdi, ai-citation.service.ts),
 *    gunluk otomatik olcum kapali (worker AI_CITATION_DAILY_CRON) ve kullanici
 *    tetikli olcum haftada bir (billing/measurement-allowance.ts) → partial.
 *    Hak hesap basina (tum siteler ortak); tablo ipucu da bunu soyler. EN
 *    metinde olcum eylemine "run" denmez: fiyat kartinda "run" aylik
 *    calistirma tavaninin birimi (plans.ts), ikisi karisiyordu.
 *  - 3: robots.txt duzeltmesi engel KALDIRMAZ; eksik AI botlarini mevcut
 *    kurallari koruyarak, onizleme + onayla ekler (robots-merge.ts,
 *    auto-fix.service.ts). Bot sayisi known-ai-bots.ts (27).
 *  - 12-15: uretim hatti 5 ajan (pipeline.service.ts), "6 ajan" degil.
 *  - 17: sosyal medya modulu yok (API'de modul/route yok) → none.
 *  - 11: otomatik yeniden yazim (content-pivot.service) yalniz Search Console
 *    bagli sitede veri bulur (Article.performanceMetrics'i gunluk GSC senkronu
 *    yazar) ve otopilot ister; kaybedilen soru → mevcut makale guncellemesi
 *    elle (content-opportunity.service, plan 'contentOpportunities' = pro)
 *    → partial.
 */
const PLAYBOOK: Array<{ step: string; tr: string; en: string; status: 'auto' | 'partial' | 'none'; noteTr: string; noteEn: string }> = [
  { step: '1-2', tr: 'AI görünürlüğünü ölç, hedef koy (share of voice, kaynak görünürlüğü, referral)', en: 'Measure AI visibility and set targets (share of voice, source visibility, referral)', status: 'partial', noteTr: 'ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek’te ölçüm; ölçümü sen başlatırsın (hesap başına haftada bir). Markalı sorular manşetten ayrı; 7 günlük ortalama + oynaklık rozeti.', noteEn: 'Measured on ChatGPT, Claude, Gemini, Perplexity, Grok and DeepSeek; you start each measurement (once a week per account). Branded queries excluded from the headline; 7-day rolling average + volatility badge.' },
  { step: '3', tr: 'robots.txt AI crawler engellerini kaldır', en: 'Unblock AI crawlers in robots.txt', status: 'partial', noteTr: 'AXO taraması 27 botu kategorili ölçer; eksik AI bot gruplarını mevcut kuralları koruyarak önizlemeli ekler, mevcut engelleri kaldırmak site sahibinin kararıdır.', noteEn: 'AXO scan checks 27 bots by category; adds missing AI bot groups with a preview while keeping your existing rules — removing existing blocks is the site owner’s decision.' },
  { step: '4', tr: 'Site denetimi (kırık link, yönlendirme, orphan, tekrar içerik)', en: 'Site audit (broken links, redirects, orphans, duplicates)', status: 'partial', noteTr: '14 kontrol + PageSpeed; orphan var, kırık link ve tekrar title henüz yok.', noteEn: '14 checks + PageSpeed; orphans yes, broken links and duplicate titles not yet.' },
  { step: '5, 19', tr: 'Marka doğruluk taraması — AI markan hakkında yanlış ne söylüyor?', en: 'Brand accuracy scan — what does AI get wrong about you?', status: 'none', noteTr: 'Sentiment ölçülüyor; doğruluk taraması yol haritasında.', noteEn: 'Sentiment is measured; accuracy scanning is on the roadmap.' },
  { step: '6-7', tr: 'Atıf alan sayfalarını ve bahsedilmeleri analiz et', en: 'Analyse your cited pages and mentions', status: 'auto', noteTr: 'Sayfa bazlı atıf kırılımı, "atıf var · ad anılmadı" sayacı, canlı cite-fetch sinyali.', noteEn: 'Per-page citation breakdown, "cited but not mentioned" counter, live cite-fetch signal.' },
  { step: '8-9', tr: 'Sayfa optimizasyonu + Article/FAQ/HowTo/Product şeması', en: 'On-page optimisation + Article/FAQ/HowTo/Product schema', status: 'auto', noteTr: '15+ şema tipi üretim ve doğrulama; geo-gate 5 yapısal kural.', noteEn: '15+ schema types generated and validated; geo-gate with 5 structural rules.' },
  { step: '10', tr: 'Site mimarisi (2-3 tıkta erişilebilir hiyerarşi)', en: 'Site architecture (key pages within 2-3 clicks)', status: 'partial', noteTr: 'Orphan tespiti ve cross-link önerileri var; mimari planlama yok.', noteEn: 'Orphan detection and cross-link suggestions exist; no architecture planner.' },
  { step: '11', tr: 'Eski içeriği güncelle (istatistik, örnek, tarih)', en: 'Refresh old content (stats, examples, dates)', status: 'partial', noteTr: 'Otomatik akış açık ve Search Console bağlıysa, yayından 30 gün sonra Search Console verisinde zayıf kalan makale haftalık taramada yeniden yazılır (Yarı otomatikte onayını bekler); kaybedilen soru için mevcut makaleyi güncelleme köprüsü (Profesyonel ve üstü).', noteEn: 'With automation on and Search Console connected, an article still weak in Search Console data 30 days after publishing is rewritten in a weekly scan (waits for your approval in semi-auto mode); lost-query → update-existing-article bridge (Professional and up).' },
  { step: '12-15', tr: 'AI\'ın tercih ettiği formatlarda içerik: rehber, karşılaştırma, soru-cevap, tablo', en: 'Content in AI-preferred formats: guides, comparisons, Q&A, tables', status: 'auto', noteTr: 'Kaybedilen soru → 5 ajanlı üretim → QA kapısı → yayın → yeniden ölçüm.', noteEn: 'Lost query → 5-agent pipeline → QA gate → publish → re-measure.' },
  { step: '13', tr: 'İçerik hub\'ı (pillar + 5-10 cluster)', en: 'Content hubs (pillar + 5-10 clusters)', status: 'partial', noteTr: 'Brain\'de pillar/cluster modeli var; hub sayfası üretimi yol haritasında.', noteEn: 'Pillar/cluster model exists in the brain; hub page generation on the roadmap.' },
  { step: '16', tr: 'E-E-A-T: yazar biyografisi, kaynak atıfları', en: 'E-E-A-T: author bios, source citations', status: 'auto', noteTr: 'Person şeması + sameAs + imza bloğu; geo-gate kaynaklı sayı kuralı.', noteEn: 'Person schema + sameAs + byline; geo-gate sourced-number rule.' },
  { step: '17', tr: 'İçeriği yeniden kullan (LinkedIn, X, YouTube)', en: 'Repurpose content (LinkedIn, X, YouTube)', status: 'none', noteTr: 'Sosyal medya paylaşım modülü şu an üründe yok.', noteEn: 'There is no social publishing module in the product right now.' },
  { step: '18', tr: '"Best of" listelerine gir, digital PR', en: 'Get into "best of" lists, digital PR', status: 'partial', noteTr: 'Product Radar listelerde sırayı ölçer; HARO pitch taslağı; başvuru elle.', noteEn: 'Product Radar tracks list positions; HARO pitch drafts; outreach is manual.' },
  { step: '20', tr: 'Reddit / Quora katkıları', en: 'Reddit / Quora contributions', status: 'partial', noteTr: 'Topluluk ajanı taslak hazırlar, onayla gönderilir (otomatik post yok).', noteEn: 'Community agent drafts replies; you approve (no auto-posting).' },
  { step: '21-22', tr: 'Sonuçları gözden geçir, döngüyü tekrarla', en: 'Review results, repeat the loop', status: 'auto', noteTr: 'Haftalık plan, aksiyon planı, yeniden ölçüm hükmü ≥2 farklı günde.', noteEn: 'Weekly plan, action plan, re-measure verdict over ≥2 different days.' },
];

const COPY = {
  tr: {
    eyebrow: '⚖️ Detaylı karşılaştırma',
    titleA: 'RanksUp vs',
    titleB: 'rakipleri',
    leadA: '+ özellik',
    lead: ' tek panelde: GEO, SEO, ASO ve Apple Search Ads. Karşılaştırma tablosundaki rakip bilgileri üreticilerin kendi sayfalarından derlendi.',
    badge1: '✓ Türkçe destek',
    badge2: '✓ KVKK + TR veri merkezi',
    badge3: '✓ PayTR ödeme',
    badge4: '✓ 14 yayın hedefi',
    hc1Num: '6',
    hc1Title: 'AI asistanında ölçüm',
    hc1Desc: 'ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek. Marka adı geçen sorular manşet skora girmez.',
    hc2Title: 'GEO/AEO aracı',
    hc2Desc: 'AI görünürlük takibi, ısı haritası, skor kartı, düşüş alarmı, llms.txt üretici, persona sohbeti ve kapalı döngü.',
    hc3Num: 'SEO + Reklam',
    hc3Title: 'Tek panelde',
    hc3Desc: 'Google Ads ve Meta Ads bağlantısı, kampanya skoru ve 6 saatlik ROAS otopilotu; SEO ve içerikle aynı panelde.',
    tableHeaderFeature: 'Özellik',
    legend: '— : Bu satırda rakip bilgisi doğrulanmadı. Rakip bilgileri üreticilerin herkese açık fiyat ve ürün sayfalarından derlenmiştir (Ekim 2026); değişmiş olabilir.',
    sumLeftTitle: 'RanksUp’ın tek panelde birleştirdiği 4 alan',
    sumLeftItems: [
      'SEO içerik üretimi ve yayın (Surfer / Jasper alternatifi)',
      'AI görünürlük ölçümü (6 asistan)',
      'Reklam otopilotu (Google Ads + Meta Ads, ROAS)',
      'Agent Readiness (AXO) taraması',
    ],
    sumLeftNote: 'Bu işleri ayrı araçlarla karşılamak birden çok abonelik demektir; rakiplerin güncel fiyatları kendi sayfalarındadır.',
    sumLeftNote2: ' RanksUp ',
    sumLeftNote3: ', ',
    sumLeftNoteEnd: '.',
    perMonth: 'ay',
    sumRightTitle: 'RanksUp’a geçişte kazandıkların',
    sumRightItems: [
      'Tek abonelik, tek panel',
      'Türkçe destek, KVKK, Türk lirasıyla ödeme',
      'AI asistanlarında görünürlük ölçümü (Grok ve DeepSeek dahil 6 asistan)',
      'Kurumsal planda BYOK: kendi sağlayıcı anahtarınla ölçüm',
    ],
    ctaTitle: 'Saatler süren işi dakikaya indir',
    ctaSub: '14 gün ücretsiz deneme, 2 makale, kart gerekmez. SEO ve AI aramadaki görünürlüğünü tek panelden ölç ve iyileştir.',
    ctaPrimary: '14 günlük ücretsiz denemeyi başlat →',
    ctaSecondary: 'Fiyatlandırmayı incele',
  },
  en: {
    eyebrow: '⚖️ Detailed comparison',
    titleA: 'RanksUp vs',
    titleB: 'the competition',
    leadA: '+ features',
    lead: ' in one dashboard: GEO, SEO, ASO and Apple Search Ads. Competitor details in the table were compiled from the vendors’ own pages.',
    badge1: '✓ Turkish support',
    badge2: '✓ KVKK + TR data center',
    badge3: '✓ PayTR payment',
    badge4: '✓ 14 publish targets',
    hc1Num: '6',
    hc1Title: 'AI assistants measured',
    hc1Desc: 'ChatGPT, Claude, Gemini, Perplexity, Grok and DeepSeek. Questions that contain your brand stay out of the headline score.',
    hc2Title: 'GEO/AEO tools',
    hc2Desc: 'AI visibility tracking, heatmap, score card, drop alert, llms.txt builder, persona chat and the closed loop.',
    hc3Num: 'SEO + Ads',
    hc3Title: 'In one panel',
    hc3Desc: 'Google Ads and Meta Ads connection, campaign score and a 6-hour ROAS autopilot, in the same panel as SEO and content.',
    tableHeaderFeature: 'Feature',
    legend: '— : Competitor information for this row was not verified. Competitor details were compiled from the vendors’ public pricing and product pages (October 2026) and may have changed.',
    sumLeftTitle: '4 areas RanksUp brings into one dashboard',
    sumLeftItems: [
      'SEO content generation and publishing (Surfer / Jasper alternative)',
      'AI visibility measurement (6 assistants)',
      'Ad autopilot (Google Ads + Meta Ads, ROAS)',
      'Agent Readiness (AXO) scan',
    ],
    sumLeftNote: 'Covering these jobs with separate tools means several subscriptions; see each vendor’s page for current prices.',
    sumLeftNote2: ' RanksUp ',
    sumLeftNote3: ', ',
    sumLeftNoteEnd: '.',
    perMonth: 'mo',
    sumRightTitle: 'What you gain by switching to RanksUp',
    sumRightItems: [
      'One subscription, one dashboard',
      'Turkish support, KVKK, payment in Turkish lira',
      'AI visibility measurement on 6 assistants, Grok and DeepSeek included',
      'BYOK on the Enterprise plan: measure with your own provider keys',
    ],
    ctaTitle: 'Cut hours-long work to minutes',
    ctaSub: '14-day free trial with 2 articles, no card. Measure and improve your visibility in SEO and AI search from one dashboard.',
    ctaPrimary: 'Start your 14-day free trial →',
    ctaSecondary: 'See pricing',
  },
} as const;

function makeCell(yesLabel: string, noLabel: string, unknownLabel: string) {
  return function Cell({ value }: { value: CellValue }) {
    if (value === true) return <Check className="h-4 w-4 text-emerald-500 mx-auto" aria-label={yesLabel} />;
    if (value === false) return <X className="h-4 w-4 text-muted-foreground/30 mx-auto" aria-label={noLabel} />;
    if (value === null) return <span className="text-xs text-center block text-muted-foreground/60" aria-label={unknownLabel} title={unknownLabel}>—</span>;
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

/**
 * Karsilastirma sayfasinin gorunumu. Fiyatlar tek kaynaktan: /billing/plans (fiyat
 * kartlariyla ayni); sabit yazildiginda sayfa sessizce bayatliyordu. Plan fiyatlari
 * SUNUCUDA (page.tsx, ISR) iki dil icin cekilip `initialPrices` ile gelir — ilk HTML'de
 * fiyat hazir. Sunucu cekimi bos kaldiysa (API kapali, build ani) istemcide istenir.
 */
export function CompareView({ initialPrices }: { initialPrices: Record<Locale, ComparePlanPrice[]> }) {
  const { locale } = useT();

  const [fetched, setFetched] = useState<Partial<Record<Locale, ComparePlanPrice[]>>>({});
  const planPrices = (initialPrices[locale]?.length ? initialPrices[locale] : fetched[locale]) ?? [];
  useEffect(() => {
    if (initialPrices[locale]?.length || fetched[locale]) return;
    // Yedek yol — api.ts yalniz burada, gerekince yuklenir (landing PricingSection ile ayni)
    import('@/lib/api')
      .then(({ api }) => api.getPlans(locale))
      .then((r) => setFetched((f) => ({ ...f, [locale]: pickComparePrices(r?.plans ?? []) })))
      .catch(() => { /* fiyat gosterilmez, sayfa calismaya devam eder */ });
  }, [locale, initialPrices, fetched]);
  const c = COPY[locale];
  const FEATURE_GROUPS = locale === 'en' ? FEATURE_GROUPS_EN : FEATURE_GROUPS_TR;
  const hasFeature = (r: FeatureRow) => r.luviai === true || (typeof r.luviai === 'string' && r.luviai !== '');
  const luviaiCount = FEATURE_GROUPS.flatMap((g) => g.rows).filter(hasFeature).length;
  // GEO/AEO kartindaki sayi tablodan sayilir — elle yazilan "8" tabloyla uyusmuyordu
  const geoCount = (FEATURE_GROUPS.find((g) => g.id === 'geo')?.rows ?? []).filter(hasFeature).length;
  const Cell = makeCell(locale === 'en' ? 'Yes' : 'Var', locale === 'en' ? 'No' : 'Yok', locale === 'en' ? 'Not verified' : 'Doğrulanmadı');
  const LuviCell = makeLuviCell(locale === 'en' ? 'Yes' : 'Var', locale === 'en' ? 'No' : 'Yok');

  return (
    <div className="bg-gradient-to-b from-background via-background to-muted/40">
      {/* JSON-LD: ComparisonTable + FAQ */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          url: `${SITE_URL}/compare`,
          name: 'RanksUp vs Surfer vs Jasper vs Ahrefs vs Frase vs GEON vs SEOYEN Comparison',
          dateModified: pageUpdated('/compare'),
          description: 'Feature comparison of AI SEO platforms — AI content, GEO/AEO, audit, publishing, ads.',
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
          <div className="absolute top-20 -left-20 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
          <div className="absolute top-60 -right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* HERO */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-600 text-xs font-semibold mb-5">
            {c.eyebrow}
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-4">
            {c.titleA}{' '}
            <span className="bg-gradient-to-r from-brand-500 via-brand-600 to-red-600 bg-clip-text text-transparent">
              {c.titleB}
            </span>
          </h1>
          <p className="text-lg text-muted-foreground mb-6">
            <strong className="text-foreground">{luviaiCount}{c.leadA}</strong>{c.lead}
          </p>
          <div className="flex flex-wrap justify-center gap-2 text-xs">
            <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">{c.badge1}</Badge>
            <Badge className="bg-brand/10 text-brand border-brand/30">{c.badge2}</Badge>
            <Badge className="bg-brand-500/10 text-brand-600 border-brand-500/30">{c.badge3}</Badge>
            <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/30">{c.badge4}</Badge>
          </div>
          <PageUpdatedLine path="/compare" className="mt-5" />
        </div>

        {/* HIGHLIGHT CARDS - Why RanksUp */}
        <div className="grid sm:grid-cols-3 gap-4 mb-12">
          <Card className="border-brand/20 bg-brand/5">
            <CardContent className="p-5">
              <div className="text-2xl font-bold text-brand mb-1">{c.hc1Num}</div>
              <div className="text-sm font-semibold mb-1">{c.hc1Title}</div>
              <p className="text-xs text-muted-foreground">{c.hc1Desc}</p>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/20 bg-emerald-500/5">
            <CardContent className="p-5">
              <div className="text-2xl font-bold text-emerald-600 mb-1">{geoCount}</div>
              <div className="text-sm font-semibold mb-1">{c.hc2Title}</div>
              <p className="text-xs text-muted-foreground">{c.hc2Desc}</p>
            </CardContent>
          </Card>
          <Card className="border-brand-500/20 bg-brand-500/5">
            <CardContent className="p-5">
              <div className="text-2xl font-bold text-brand-600 mb-1">{c.hc3Num}</div>
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
                      <th className="text-left px-4 py-2.5 font-semibold w-[34%]">{c.tableHeaderFeature}</th>
                      <th className="px-2 py-2.5 text-center bg-brand/5 font-bold text-brand min-w-[80px]">RanksUp</th>
                      <th className="px-2 py-2.5 text-center font-medium min-w-[80px]">Surfer</th>
                      <th className="px-2 py-2.5 text-center font-medium min-w-[80px]">Jasper</th>
                      <th className="px-2 py-2.5 text-center font-medium min-w-[80px]">Ahrefs</th>
                      <th className="px-2 py-2.5 text-center font-medium min-w-[80px]">Frase</th>
                      <th className="px-2 py-2.5 text-center font-medium min-w-[80px]">GEON</th>
                      <th className="px-2 py-2.5 text-center font-medium min-w-[80px]">SEOYEN</th>
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
                        <td className="px-2 py-3 text-center"><Cell value={f.geon ?? null} /></td>
                        <td className="px-2 py-3 text-center"><Cell value={f.seoyen ?? null} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
          <p className="text-xs text-muted-foreground px-1">{c.legend}</p>
        </div>

        {/* SEMRUSH 6-AYLIK AI ARAMA PLAYBOOK'U — hangi adim RanksUp'ta otomatik? */}
        <Card className="mt-10 overflow-hidden">
          <div className="bg-gradient-to-r from-muted/60 to-muted/20 px-5 py-3 border-b">
            <h2 className="font-semibold flex items-center gap-2 text-base">
              <span className="text-brand"><BarChart3 className="h-4 w-4" /></span>
              {locale === 'en' ? 'Semrush\'s 6-month AI search playbook — which steps run on autopilot in RanksUp?' : 'Semrush\'ın 6 aylık AI arama playbook\'u — hangi adım RanksUp\'ta otomatik?'}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {locale === 'en'
                ? 'Semrush publishes a 22-step, six-month manual plan (May 2026). Same metrics as ours (share of voice, source visibility, referral traffic). Here is what the closed loop does for you.'
                : 'Semrush 22 adımlık, altı aylık elle yürütülen bir plan yayınladı (Mayıs 2026). Metrikleri bizimkiyle aynı (share of voice, kaynak görünürlüğü, referral trafik). Kapalı döngünün senin yerine yaptıkları:'}
            </p>
          </div>
          <div className="divide-y divide-border/40">
            {PLAYBOOK.map((row) => {
              const label = row.status === 'auto' ? (locale === 'en' ? 'Automatic' : 'Otomatik') : row.status === 'partial' ? (locale === 'en' ? 'Partial' : 'Kısmen') : (locale === 'en' ? 'Not yet' : 'Henüz yok');
              const cls = row.status === 'auto' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' : row.status === 'partial' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/30';
              return (
                <div key={row.step} className="px-5 py-2.5 text-sm flex items-start gap-3">
                  <span className="text-xs font-mono text-muted-foreground w-10 shrink-0 pt-0.5">{row.step}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{locale === 'en' ? row.en : row.tr}</div>
                    <div className="text-xs text-muted-foreground">{locale === 'en' ? row.noteEn : row.noteTr}</div>
                  </div>
                  <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${cls}`}>{label}</span>
                </div>
              );
            })}
          </div>
          <div className="px-5 py-3 text-xs text-muted-foreground border-t">
            {locale === 'en'
              ? 'Source: Semrush, "How to Rank in AI Search" (Tushar Pol, 4 May 2026). Statuses reflect RanksUp features as of Aug 2026; steps 1-2, 3, 12-15 and 17 updated in Oct 2026.'
              : 'Kaynak: Semrush, "How to Rank in AI Search" (Tushar Pol, 4 Mayıs 2026). Durumlar Ağustos 2026 itibarıyla RanksUp özelliklerini yansıtır; 1-2, 3, 12-15 ve 17. adımlar Ekim 2026’da güncellendi.'}
          </div>
        </Card>

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
                {/* Rakip fiyat toplami (Surfer $89 + Jasper $49 + Ahrefs $129 +
                    Hootsuite $99 = $366, ≈ ₺14.640) kaldirildi: Hootsuite RanksUp'in
                    artik sunmadigi sosyal yayin icindi, TL 40 TL/USD sabit kurla
                    hesaplanmisti ve Surfer/Jasper fiyatlari 18.10.2026'da ureticinin
                    sayfasindakiyle uyusmuyordu. Bayatlayan rakip fiyati yazilmaz. */}
                {c.sumLeftNote}
                {/* RanksUp fiyatlari ELLE YAZILMAZ. Burada '₺1.499 ($37)' ve
                    '₺4.999 ($125)' sabitleri duruyordu; gercek fiyatlar $149 ve
                    $349 oldugu icin sayfa dort kata varan yanlis fiyat
                    gosteriyordu. Artik /billing/plans ile ayni kaynak. */}
                {planPrices.map((p, i) => (
                  <span key={p.id}>
                    {i === 0 ? c.sumLeftNote2 : c.sumLeftNote3}
                    {p.name}: <strong className="text-brand">${p.monthly.toLocaleString('en-US')}/{c.perMonth}</strong>
                  </span>
                ))}
                {planPrices.length > 0 && c.sumLeftNoteEnd}
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
        <div className="mt-16 rounded-2xl bg-gradient-to-br from-brand-500 via-brand-600 to-red-600 text-white p-10 text-center">
          <h3 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold mb-3">{c.ctaTitle}</h3>
          <p className="text-white/90 mb-6 max-w-xl mx-auto">{c.ctaSub}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-white text-brand-600 hover:bg-white/90 shadow-xl">
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
