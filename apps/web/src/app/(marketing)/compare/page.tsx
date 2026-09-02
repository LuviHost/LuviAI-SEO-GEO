'use client';

import Link from 'next/link';
import { Check, X, Crown, Sparkles, Zap, Globe, Shield, Network, Award, BarChart3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useT } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

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
      { name: 'Kapalı döngü: kaybedilen soru → içerik → QA → yeniden ölçüm', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false, hint: 'Cloudflare\'in AEO / agent-readiness panosu sitenin AI\'a erişilebilirliğini ölçer ama içerik üretmez ve yeniden ölçmez; RanksUp erişimi (AXO), görünürlüğü ve üretimi tek döngüde kapatır.' },
    ],
  },
  {
    title: 'SEO & Site Audit',
    icon: <Shield className="h-4 w-4" />,
    rows: [
      { name: 'Otomatik site audit', luviai: '14 kontrol', surfer: 'kısmi', jasper: false, ahrefs: 'detaylı', frase: 'kısmi' },
      { name: 'GSC entegrasyonu', luviai: true, surfer: false, jasper: false, ahrefs: true, frase: true },
      { name: 'Organik trafik verisi: Search Console gerçeği vs. tahmin', luviai: 'GSC gerçek', surfer: false, jasper: false, ahrefs: 'tahmin', frase: 'kısmi', hint: 'Üçüncü taraf araçların "organik trafik" rakamı modelleme tahminidir (aynı site için Ahrefs 189/ay derken Search Console 2.000+ gösterebilir). RanksUp birinci-taraf GSC verisini ve markalı/markasız ayrımını kullanır.' },
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
      { name: 'Closed loop: lost query → content → QA → re-measure', luviai: true, surfer: false, jasper: false, ahrefs: false, frase: false, hint: 'Cloudflare\'s AEO / agent-readiness dashboard measures whether AI can reach your site but produces no content and never re-measures; RanksUp closes access (AXO), visibility and production in one loop.' },
    ],
  },
  {
    title: 'SEO & Site Audit',
    icon: <Shield className="h-4 w-4" />,
    rows: [
      { name: 'Automatic site audit', luviai: '14 checks', surfer: 'partial', jasper: false, ahrefs: 'detailed', frase: 'partial' },
      { name: 'GSC integration', luviai: true, surfer: false, jasper: false, ahrefs: true, frase: true },
      { name: 'Organic traffic data: Search Console truth vs. estimates', luviai: 'GSC actuals', surfer: false, jasper: false, ahrefs: 'estimate', frase: 'partial', hint: 'Third-party "organic traffic" numbers are modelled estimates (the same site can show 189/mo in Ahrefs and 2,000+ in Search Console). RanksUp uses first-party GSC data with a branded/non-branded split.' },
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
      { name: 'Yearly discount', luviai: '17%', surfer: '30%', jasper: '20%', ahrefs: '20%', frase: '10%' },
      { name: '2 free articles', luviai: true, surfer: false, jasper: '5-day trial', ahrefs: false, frase: '5 trial' },
      { name: 'Monthly cancel — no commitment', luviai: true, surfer: true, jasper: true, ahrefs: false, frase: true },
    ],
  },
];

/**
 * Semrush 6-aylik AI arama playbook'u (22 adim) — RanksUp'taki karsiligi.
 * Durumlar kod dogrulamasina dayanir (27.08.2026): auto = urun kendiliginden
 * yapar, partial = kismen/elle tetikli, none = henuz yok. Rakibin kendi
 * rehberi bizim kapali dongumuzun en iyi satis dokumani.
 */
const PLAYBOOK: Array<{ step: string; tr: string; en: string; status: 'auto' | 'partial' | 'none'; noteTr: string; noteEn: string }> = [
  { step: '1-2', tr: 'AI görünürlüğünü ölç, hedef koy (share of voice, kaynak görünürlüğü, referral)', en: 'Measure AI visibility and set targets (share of voice, source visibility, referral)', status: 'auto', noteTr: '7 AI asistanda günlük ölçüm; markalı sorular manşetten ayrı; 7 günlük ortalama + oynaklık rozeti.', noteEn: 'Daily probes across 7 assistants; branded queries excluded from the headline; 7-day rolling average + volatility badge.' },
  { step: '3', tr: 'robots.txt AI crawler engellerini kaldır', en: 'Unblock AI crawlers in robots.txt', status: 'auto', noteTr: 'AXO taraması 27 botu kategorili ölçer; tek tıkla düzeltir.', noteEn: 'AXO scan checks 27 bots by category; one-click fix.' },
  { step: '4', tr: 'Site denetimi (kırık link, yönlendirme, orphan, tekrar içerik)', en: 'Site audit (broken links, redirects, orphans, duplicates)', status: 'partial', noteTr: '14 kontrol + PageSpeed; orphan var, kırık link ve tekrar title henüz yok.', noteEn: '14 checks + PageSpeed; orphans yes, broken links and duplicate titles not yet.' },
  { step: '5, 19', tr: 'Marka doğruluk taraması — AI markan hakkında yanlış ne söylüyor?', en: 'Brand accuracy scan — what does AI get wrong about you?', status: 'none', noteTr: 'Sentiment ölçülüyor; doğruluk taraması yol haritasında.', noteEn: 'Sentiment is measured; accuracy scanning is on the roadmap.' },
  { step: '6-7', tr: 'Atıf alan sayfalarını ve bahsedilmeleri analiz et', en: 'Analyse your cited pages and mentions', status: 'auto', noteTr: 'Sayfa bazlı atıf kırılımı, "atıf var · ad anılmadı" sayacı, canlı cite-fetch sinyali.', noteEn: 'Per-page citation breakdown, "cited but not mentioned" counter, live cite-fetch signal.' },
  { step: '8-9', tr: 'Sayfa optimizasyonu + Article/FAQ/HowTo/Product şeması', en: 'On-page optimisation + Article/FAQ/HowTo/Product schema', status: 'auto', noteTr: '15+ şema tipi üretim ve doğrulama; geo-gate 5 yapısal kural.', noteEn: '15+ schema types generated and validated; geo-gate with 5 structural rules.' },
  { step: '10', tr: 'Site mimarisi (2-3 tıkta erişilebilir hiyerarşi)', en: 'Site architecture (key pages within 2-3 clicks)', status: 'partial', noteTr: 'Orphan tespiti ve cross-link önerileri var; mimari planlama yok.', noteEn: 'Orphan detection and cross-link suggestions exist; no architecture planner.' },
  { step: '11', tr: 'Eski içeriği güncelle (istatistik, örnek, tarih)', en: 'Refresh old content (stats, examples, dates)', status: 'auto', noteTr: '30 gün sonra performansa göre pivot; kaybedilen soru için mevcut makaleyi güncelleme köprüsü.', noteEn: 'Performance-based pivot after 30 days; lost-query → update-existing-article bridge.' },
  { step: '12-15', tr: 'AI\'ın tercih ettiği formatlarda içerik: rehber, karşılaştırma, soru-cevap, tablo', en: 'Content in AI-preferred formats: guides, comparisons, Q&A, tables', status: 'auto', noteTr: 'Kaybedilen soru → 6 ajanlı üretim → QA kapısı → yayın → yeniden ölçüm.', noteEn: 'Lost query → 6-agent pipeline → QA gate → publish → re-measure.' },
  { step: '13', tr: 'İçerik hub\'ı (pillar + 5-10 cluster)', en: 'Content hubs (pillar + 5-10 clusters)', status: 'partial', noteTr: 'Brain\'de pillar/cluster modeli var; hub sayfası üretimi yol haritasında.', noteEn: 'Pillar/cluster model exists in the brain; hub page generation on the roadmap.' },
  { step: '16', tr: 'E-E-A-T: yazar biyografisi, kaynak atıfları', en: 'E-E-A-T: author bios, source citations', status: 'auto', noteTr: 'Person şeması + sameAs + imza bloğu; geo-gate kaynaklı sayı kuralı.', noteEn: 'Person schema + sameAs + byline; geo-gate sourced-number rule.' },
  { step: '17', tr: 'İçeriği yeniden kullan (LinkedIn, X, YouTube)', en: 'Repurpose content (LinkedIn, X, YouTube)', status: 'auto', noteTr: 'Sosyal medya modülü: makaleden gönderi, onay akışı, gelen kutusu.', noteEn: 'Social module: posts from articles, approval flow, inbox.' },
  { step: '18', tr: '"Best of" listelerine gir, digital PR', en: 'Get into "best of" lists, digital PR', status: 'partial', noteTr: 'Product Radar listelerde sırayı ölçer; HARO pitch taslağı; başvuru elle.', noteEn: 'Product Radar tracks list positions; HARO pitch drafts; outreach is manual.' },
  { step: '20', tr: 'Reddit / Quora katkıları', en: 'Reddit / Quora contributions', status: 'partial', noteTr: 'Topluluk ajanı taslak hazırlar, onayla gönderilir (otomatik post yok).', noteEn: 'Community agent drafts replies; you approve (no auto-posting).' },
  { step: '21-22', tr: 'Sonuçları gözden geçir, döngüyü tekrarla', en: 'Review results, repeat the loop', status: 'auto', noteTr: 'Haftalık plan, aksiyon planı, yeniden ölçüm hükmü ≥2 farklı günde.', noteEn: 'Weekly plan, action plan, re-measure verdict over ≥2 different days.' },
];

const COPY = {
  tr: {
    eyebrow: '⚖️ Detaylı karşılaştırma',
    titleA: 'RanksUp vs',
    titleB: 'tüm rakipleri',
    leadA: '+ özellik',
    lead: ' tek panelde. GEO + SEO + ASO + Apple Search Ads — diğerleri tek bir alanda iyi, RanksUp hepsini birleştiren tek Türk platform.',
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
      'Agent Readiness (AXO) taraması',
    ],
    sumLeftNote: 'Aynı işi rakip kombinasyonuyla almak: Surfer ($89) + Jasper ($49) + Ahrefs ($129) + Hootsuite ($99) = ',
    sumLeftNotePrice: '$366/ay (≈ ₺14.640)',
    sumLeftNote2: '. RanksUp ',
    sumLeftNote3: ', ',
    sumLeftNoteEnd: '.',
    perMonth: 'ay',
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
    sumLeftNote2: '. RanksUp ',
    sumLeftNote3: ', ',
    sumLeftNoteEnd: '.',
    perMonth: 'mo',
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

  // Fiyatlar tek kaynaktan: /billing/plans (fiyat kartlariyla ayni).
  // Sabit yazildiginda sayfa sessizce bayatliyordu.
  const [planPrices, setPlanPrices] = useState<Array<{
    id: string; name: string; monthly: number;
  }>>([]);
  useEffect(() => {
    api.getPlans(locale)
      .then((r) => setPlanPrices(
        (r?.plans ?? []).filter((p) => p.id === 'starter' || p.id === 'pro'),
      ))
      .catch(() => { /* fiyat gosterilmez, sayfa calismaya devam eder */ });
  }, [locale]);
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
              ? 'Source: Semrush, "How to Rank in AI Search" (Tushar Pol, 4 May 2026). Statuses reflect RanksUp features as of Aug 2026.'
              : 'Kaynak: Semrush, "How to Rank in AI Search" (Tushar Pol, 4 Mayıs 2026). Durumlar Ağustos 2026 itibarıyla RanksUp özelliklerini yansıtır.'}
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
                {c.sumLeftNote}<strong className="text-foreground">{c.sumLeftNotePrice}</strong>
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
                {c.sumLeftNoteEnd}
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
